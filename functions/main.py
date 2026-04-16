import os
import json
import time
import datetime
import hashlib
import re
import requests
from urllib.parse import urlparse
from zoneinfo import ZoneInfo
from firebase_functions import https_fn, scheduler_fn
from firebase_admin import initialize_app, firestore, get_app
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1alpha import AlphaAnalyticsDataClient
from google.oauth2 import service_account
from google.analytics.data_v1alpha.types import (
    DateRange as FunnelDateRange,
    Dimension as FunnelDimension,
    Funnel as AnalyticsFunnel,
    FunnelEventFilter,
    FunnelFieldFilter,
    FunnelFilterExpression,
    FunnelFilterExpressionList,
    FunnelNextAction,
    FunnelStep as AnalyticsFunnelStep,
    RunFunnelReportRequest,
    StringFilter as FunnelStringFilter,
)
from google.analytics.data_v1beta.types import (
    DateRange as AnalyticsDateRange,
    Dimension,
    Filter,
    FilterExpression,
    FilterExpressionList,
    Metric,
    OrderBy,
    RunReportRequest,
)
from property_catalog import ALL_PROPERTY_IDS, PROPERTY_PORTFOLIO_BY_ID

ENTRATA_PROPERTY_ID = int(os.environ.get("ENTRATA_PROPERTY_ID", "100135280"))
ENTRATA_STUDENT_ORG_SLUG = os.environ.get("ENTRATA_STUDENT_ORG_SLUG", "redstoneresidential")
ENTRATA_MULTIFAMILY_ORG_SLUG = os.environ.get("ENTRATA_MULTIFAMILY_ORG_SLUG", "redstoneconventional")
ENTRATA_MULTIFAMILY_API_KEY = os.environ.get("ENTRATA_API_KEY_MULTIFAMILY")
OPINIION_API_BASE_URL = os.environ.get("OPINIION_API_BASE_URL", "https://api.opiniion.com")
OPINIION_LOCATION_FIELD = os.environ.get("OPINIION_LOCATION_FIELD", "opiniionLocationId")

DOCUMENT_ID_CANDIDATES = {
    "leads": ["leadId", "leadID", "prospectId", "prospectID", "customerId", "customerID", "id"],
    "events": ["eventId", "eventID", "id"],
    "leases": ["leaseId", "leaseID", "residentLeaseId", "residentLeaseID", "recordId", "id"],
    "invoices": ["invoiceId", "invoiceID", "arInvoiceId", "arInvoiceID", "referenceNumber", "id"],
    "availability": ["unitId", "unitID", "unitNumber", "id"],
    "specials": ["specialId", "specialID", "id", "title", "name"],
}

LEAD_EVENT_TYPE_IDS = "1,3,7,9,10,70,78,12,13,21"
MARKETING_GL_ACCOUNT_FROM = os.environ.get("MARKETING_GL_ACCOUNT_FROM", "5300-0010")
MARKETING_GL_ACCOUNT_TO = os.environ.get("MARKETING_GL_ACCOUNT_TO", "5300-0410")
APP_TIMEZONE = ZoneInfo(os.environ.get("APP_TIMEZONE", "America/Denver"))
SYNC_STATE_COLLECTION = os.environ.get("SYNC_STATE_COLLECTION", "_sync_state")
SYNC_RETRY_COLLECTION = os.environ.get("SYNC_RETRY_COLLECTION", "_sync_retries")
BACKGROUND_BACKFILL_BATCH_SIZE = int(os.environ.get("BACKGROUND_BACKFILL_BATCH_SIZE", "6"))
BACKGROUND_BACKFILL_TOTAL_DAYS = int(os.environ.get("BACKGROUND_BACKFILL_TOTAL_DAYS", "120"))
DAILY_REFRESH_BATCH_SIZE = int(os.environ.get("DAILY_REFRESH_BATCH_SIZE", "16"))
DAILY_REFRESH_LOOKBACK_DAYS = int(os.environ.get("DAILY_REFRESH_LOOKBACK_DAYS", "2"))
RETRY_BATCH_SIZE = int(os.environ.get("RETRY_BATCH_SIZE", "5"))
RETRY_MAX_ATTEMPTS = int(os.environ.get("RETRY_MAX_ATTEMPTS", "5"))
LEASE_ATTRIBUTION_LOOKBACK_DAYS = int(os.environ.get("LEASE_ATTRIBUTION_LOOKBACK_DAYS", "30"))
LEASE_ATTRIBUTION_FUTURE_MOVE_IN_DAYS = int(os.environ.get("LEASE_ATTRIBUTION_FUTURE_MOVE_IN_DAYS", "365"))
LEASE_ATTRIBUTION_LEAD_LOOKBACK_DAYS = int(os.environ.get("LEASE_ATTRIBUTION_LEAD_LOOKBACK_DAYS", "400"))
LEASE_ATTRIBUTION_PAGE_SIZE = int(os.environ.get("LEASE_ATTRIBUTION_PAGE_SIZE", "500"))
ROI_PIPELINE_RAW_BATCH_SIZE = int(os.environ.get("ROI_PIPELINE_RAW_BATCH_SIZE", "24"))
ROI_PIPELINE_PROPERTY_BATCH_SIZE = int(os.environ.get("ROI_PIPELINE_PROPERTY_BATCH_SIZE", "6"))
ROI_DAILY_RAW_LOOKBACK_DAYS = int(os.environ.get("ROI_DAILY_RAW_LOOKBACK_DAYS", "7"))
ROI_DAILY_REPORT_LOOKBACK_DAYS = int(os.environ.get("ROI_DAILY_REPORT_LOOKBACK_DAYS", "30"))

# These properties were intentionally excluded from portfolio-wide automation.
# We keep them out of background backfills / ROI / daily refresh to avoid known
# access failures and unnecessary retry churn.
EXCLUDED_AUTOMATION_PROPERTY_IDS = {
    1132322,  # CollegePlace - Avenues I
    1132323,  # CollegePlace - Avenues II
    1132324,  # CollegePlace - Elements
    1132325,  # CollegePlace - Horizon
    1132326,  # CollegePlace - Madison
    1132327,  # CollegePlace - Paces
    1132328,  # CollegePlace - Seven Two One
    1132329,  # CollegePlace - Vue
    1248940,  # The Izzy
}

LEAD_IDENTIFIER_KEYS = [
    "applicationId",
    "leaseIntervalId",
    "leaseId",
    "leadId",
    "leadID",
    "prospectId",
    "prospectID",
    "customerId",
    "customerID",
    "id",
]

LEASE_MATCH_IDENTIFIER_KEYS = [
    "applicationId",
    "leaseIntervalId",
    "leaseId",
    "leadId",
    "leadID",
    "prospectId",
    "prospectID",
    "customerId",
    "customerID",
]

PERFORMANCE_MARKETING_GL_CODES = {"5300-0030", "5300-0210"}
ALL_MARKETING_GL_CODES = {
    "5300-0010",
    "5300-0030",
    "5300-0210",
    "5300-0320",
    "5300-0330",
    "5300-0400",
    "5300-0410",
}

_GA4_CREDENTIALS_CACHE = None


def get_ga4_credentials():
    global _GA4_CREDENTIALS_CACHE
    if _GA4_CREDENTIALS_CACHE is not None:
        return _GA4_CREDENTIALS_CACHE

    raw_credentials = (
        os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
        or os.environ.get("GOOGLE_SERVICE_ACCOUNT_KEY")
    )
    if not raw_credentials:
        return None

    try:
        info = json.loads(raw_credentials)
    except json.JSONDecodeError as exc:
        raise ValueError(
            "GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON."
        ) from exc

    _GA4_CREDENTIALS_CACHE = service_account.Credentials.from_service_account_info(info)
    return _GA4_CREDENTIALS_CACHE


def build_ga4_clients():
    credentials = get_ga4_credentials()
    if credentials is None:
        return BetaAnalyticsDataClient(), AlphaAnalyticsDataClient()
    return (
        BetaAnalyticsDataClient(credentials=credentials),
        AlphaAnalyticsDataClient(credentials=credentials),
    )
PERFORMANCE_MARKETING_DESCRIPTIONS = [
    "internet advertising",
    "ppc management fees",
]
ACTIVE_ADVERTISING_PATTERNS = [
    "apartments.com",
    "google ads",
    "facebook ads",
    "meta ads",
    "social ads",
    "rent college pads",
    "rentcollegepads",
    "zillow",
    "find my place",
    "myplace",
    "geofencing",
    "digible",
]
ALL_MARKETING_DESCRIPTIONS = [
    "general advertising & marketing",
    "internet advertising",
    "ppc management fees",
    "seo",
    "reputation management",
    "social media management",
    "website expense",
]

SOURCE_CATEGORY_PATTERNS = [
    ("google_ads", "Google Ads", ["google", "ppc"]),
    ("meta_ads", "Meta Ads", ["facebook", "meta", "instagram"]),
    ("apartments_com", "Apartments.com", ["apartments.com", "apartments com", "apts.com"]),
    ("zillow", "Zillow", ["zillow"]),
    ("rent_college_pads", "Rent College Pads", ["rent college pads", "rentcollegepads"]),
    ("find_my_place", "Find My Place", ["find my place", "myplace"]),
    ("digible", "Digible", ["digible"]),
    ("organic_direct", "Organic / Direct", ["organic", "direct", "website", "web site"]),
    ("referral", "Referral", ["referral", "resident referral"]),
]

GA4_CONVERSION_EVENTS = [
    "account_created",
    "application_submitted",
    "basic_info_save_and_continue",
    "contact_us_submit_button",
]

LLM_SOURCES = [
    "chatgpt",
    "openai",
    "claude",
    "anthropic",
    "gemini",
    "bard",
    "perplexity",
    "copilot",
]

COMMON_PROPERTY_TERMS = {
    "apartments",
    "apartment",
    "homes",
    "home",
    "living",
    "lofts",
    "loft",
    "flats",
    "flat",
    "village",
    "place",
    "park",
    "station",
    "square",
    "commons",
    "community",
    "communities",
    "residences",
    "residential",
    "house",
    "house",
    "the",
    "at",
    "on",
    "of",
    "and",
}

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
}

def init_firebase():
    try:
        get_app()
    except ValueError:
        initialize_app()

def get_automation_property_ids():
    return [
        int(property_id)
        for property_id in ALL_PROPERTY_IDS
        if int(property_id) not in EXCLUDED_AUTOMATION_PROPERTY_IDS
    ]

def get_local_now():
    return datetime.datetime.now(APP_TIMEZONE)

def get_firestore_date_id_from_offset(day_offset):
    return (get_local_now() - datetime.timedelta(days=day_offset)).strftime("%Y-%m-%d")

def get_request_date_from_offset(day_offset):
    return (get_local_now() - datetime.timedelta(days=day_offset)).strftime("%m/%d/%Y")

def parse_entrata_date(value):
    if not value:
        return None

    value = str(value).strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return datetime.datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None

def format_entrata_date(value):
    if not value:
        return None
    if isinstance(value, datetime.datetime):
        value = value.date()
    return value.strftime("%m/%d/%Y")

def parse_iso_date(value):
    if not value:
        return None
    try:
        return datetime.date.fromisoformat(str(value))
    except ValueError:
        return None

def normalize_string(value):
    if value in (None, ""):
        return None
    return str(value)

def parse_currency_amount(value):
    if value in (None, ""):
        return 0.0
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return 0.0

def ensure_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]

def extract_nested_items(result, section_key, item_key):
    section = result.get(section_key, [])
    if isinstance(section, list):
        section = section[0] if section else {}

    if not isinstance(section, dict):
        return []

    items = section.get(item_key, [])
    if isinstance(items, dict):
        return [items]
    if isinstance(items, list):
        return items
    return []

def canonicalize_list_for_hash(items):
    serialized_items = []
    for item in items or []:
        serialized_items.append(json.dumps(item, sort_keys=True, default=str))
    serialized_items.sort()
    return serialized_items

def compute_payload_hash(value):
    serialized = json.dumps(value, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()

def compute_specials_hash(items):
    canonical = canonicalize_list_for_hash(items)
    return compute_payload_hash(canonical)

def extract_special_items(result):
    specials_root = result.get("specials") or result.get("Specials")
    if isinstance(specials_root, dict):
        property_specials = specials_root.get("propertySpecials") or specials_root.get("PropertySpecials")
        if isinstance(property_specials, dict):
            special_map = property_specials.get("special") or property_specials.get("Special")
            if isinstance(special_map, dict):
                if all(isinstance(value, dict) for value in special_map.values()):
                    return list(special_map.values())
                return [special_map]
            if isinstance(special_map, list):
                return special_map

    for section_key, item_key in [
        ("specials", "special"),
        ("specials", "Special"),
        ("Specials", "special"),
        ("Specials", "Special"),
    ]:
        items = extract_nested_items(result, section_key, item_key)
        if items:
            return items

    specials_value = specials_root
    if isinstance(specials_value, list):
        return specials_value
    if isinstance(specials_value, dict):
        for nested_key in ("special", "Special"):
            nested_value = specials_value.get(nested_key)
            if isinstance(nested_value, list):
                return nested_value
            if isinstance(nested_value, dict):
                return [nested_value]
        return [specials_value]

    return []

def store_property_specials(property_id, specials_items, raw_result=None):
    db = firestore.client()
    property_ref = db.collection("properties").document(str(property_id))
    specials_ref = property_ref.collection("specials").document("current")
    specials_hash = compute_specials_hash(specials_items)
    current_snapshot = specials_ref.get()
    current_hash = None

    if current_snapshot.exists:
        current_hash = (current_snapshot.to_dict() or {}).get("specials_hash")

    if current_hash == specials_hash:
        return {
            "property_id": property_id,
            "changed": False,
            "special_count": len(specials_items),
            "specials_hash": specials_hash,
        }

    request_config = get_property_request_config(property_id)
    specials_ref.set({
        "property_id": property_id,
        "portfolio": request_config["portfolio"],
        "org_slug": request_config["org_slug"],
        "special_count": len(specials_items),
        "specials": specials_items,
        "specials_hash": specials_hash,
        "raw_result": raw_result or {},
        "last_changed_at": firestore.SERVER_TIMESTAMP,
        "last_synced_at": firestore.SERVER_TIMESTAMP,
    }, merge=True)

    return {
        "property_id": property_id,
        "changed": True,
        "special_count": len(specials_items),
        "specials_hash": specials_hash,
    }

def extract_property_availability_snapshot(result):
    properties = extract_nested_items(result, "Properties", "Property")
    property_entry = properties[0] if properties else {}
    floorplans = extract_nested_items(property_entry, "Floorplans", "Floorplan") if isinstance(property_entry, dict) else []
    property_units = extract_nested_items(result, "PropertyUnits", "PropertyUnit")
    return property_entry, floorplans, property_units

def build_property_availability_snapshot(property_id, result):
    property_entry, floorplans, property_units = extract_property_availability_snapshot(result)
    return {
        "property_id": property_id,
        "property": property_entry,
        "floorplans": floorplans,
        "units": property_units,
        "floorplan_count": len(floorplans),
        "unit_count": len(property_units),
        "availability_url": property_entry.get("propertyAvailabilityURL") if isinstance(property_entry, dict) else None,
    }

def store_property_availability_pricing(property_id, result):
    db = firestore.client()
    property_ref = db.collection("properties").document(str(property_id))
    snapshot_ref = property_ref.collection("availability_pricing").document("current")
    snapshot_payload = build_property_availability_snapshot(property_id, result)
    snapshot_hash = compute_payload_hash(snapshot_payload)
    current_snapshot = snapshot_ref.get()
    current_hash = None

    if current_snapshot.exists:
        current_hash = (current_snapshot.to_dict() or {}).get("snapshot_hash")

    if current_hash == snapshot_hash:
        snapshot_ref.set({
            "last_synced_at": firestore.SERVER_TIMESTAMP,
        }, merge=True)
        return {
            "property_id": property_id,
            "changed": False,
            "floorplan_count": snapshot_payload["floorplan_count"],
            "unit_count": snapshot_payload["unit_count"],
            "snapshot_hash": snapshot_hash,
        }

    request_config = get_property_request_config(property_id)
    snapshot_ref.set({
        **snapshot_payload,
        "snapshot_hash": snapshot_hash,
        "portfolio": request_config["portfolio"],
        "org_slug": request_config["org_slug"],
        "raw_result": result or {},
        "last_changed_at": firestore.SERVER_TIMESTAMP,
        "last_synced_at": firestore.SERVER_TIMESTAMP,
    }, merge=True)

    return {
        "property_id": property_id,
        "changed": True,
        "floorplan_count": snapshot_payload["floorplan_count"],
        "unit_count": snapshot_payload["unit_count"],
        "snapshot_hash": snapshot_hash,
    }

def first_non_empty(*values):
    for value in values:
        if value not in (None, ""):
            return value
    return None

def calculate_month_span(start_date, end_date):
    if not start_date or not end_date or end_date < start_date:
        return 0
    month_delta = (end_date.year - start_date.year) * 12 + (end_date.month - start_date.month)
    if end_date.day >= start_date.day:
        month_delta += 1
    return max(month_delta, 0)

def serialize_date(value):
    return value.isoformat() if isinstance(value, (datetime.date, datetime.datetime)) else None

def get_collection_identifiers(item, keys):
    identifiers = []
    seen = set()
    for key in keys:
        value = normalize_string(item.get(key))
        if value and value not in seen:
            seen.add(value)
            identifiers.append(value)
    return identifiers

def get_lead_source(lead_data):
    return first_non_empty(
        lead_data.get("leadSource"),
        lead_data.get("internetListingService"),
        lead_data.get("source"),
        "Unknown",
    )

def normalize_email(value):
    if not value:
        return None
    return str(value).strip().lower()

def normalize_phone(value):
    if not value:
        return None
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits or None

def normalize_full_name(value):
    if not value:
        return None
    normalized = re.sub(r"[^a-z0-9]+", " ", str(value).strip().lower())
    normalized = " ".join(part for part in normalized.split() if part)
    return normalized or None

def recursively_find_first_value(value, candidate_keys):
    lowered_keys = {key.lower() for key in candidate_keys}
    if isinstance(value, dict):
        for key, nested_value in value.items():
            if str(key).lower() in lowered_keys and nested_value not in (None, ""):
                return nested_value
        for nested_value in value.values():
            found = recursively_find_first_value(nested_value, candidate_keys)
            if found not in (None, ""):
                return found
    elif isinstance(value, list):
        for nested_value in value:
            found = recursively_find_first_value(nested_value, candidate_keys)
            if found not in (None, ""):
                return found
    return None

def is_guest_card_record(record):
    search_space = " ".join(collect_primitive_values(record)).lower()
    return "guest card" in search_space or "guestcard" in search_space

def collect_primitive_values(value):
    if isinstance(value, list):
        collected = []
        for item in value:
            collected.extend(collect_primitive_values(item))
        return collected
    if isinstance(value, dict):
        collected = []
        for item in value.values():
            collected.extend(collect_primitive_values(item))
        return collected
    return [] if value is None else [str(value)]

def canonicalize_source_label(value, default_label="Other"):
    normalized = str(value or "").strip().lower()
    if not normalized:
        return {"source_key": "other", "source_label": default_label}

    for source_key, source_label, patterns in SOURCE_CATEGORY_PATTERNS:
        if any(pattern in normalized for pattern in patterns):
            return {"source_key": source_key, "source_label": source_label}

    safe_key = "".join(ch if ch.isalnum() else "_" for ch in normalized).strip("_") or "other"
    return {"source_key": safe_key[:80], "source_label": str(value).strip()}

def get_invoice_gl_codes(invoice):
    search_space = " ".join(collect_primitive_values(invoice))
    exact_matches = set()

    import re
    for match in re.findall(r"\b\d{4}-\d{4}\b", search_space):
        exact_matches.add(match)
    for match in re.findall(r"\b\d{8}\b", search_space):
        exact_matches.add(f"{match[:4]}-{match[4:]}")
    for match in re.findall(r"\b\d{4}\s\d{4}\b", search_space):
        exact_matches.add(match.replace(" ", "-"))
    return sorted(exact_matches)

def has_invoice_classification(invoice, allowed_codes, allowed_descriptions):
    codes = get_invoice_gl_codes(invoice)
    if any(code in allowed_codes for code in codes):
        return True
    search_space = " ".join(collect_primitive_values(invoice)).lower()
    return any(description in search_space for description in allowed_descriptions)

def is_active_advertising_invoice(invoice):
    search_space = " ".join(collect_primitive_values(invoice)).lower()
    return any(pattern in search_space for pattern in ACTIVE_ADVERTISING_PATTERNS)

def get_invoice_amount(invoice):
    detail_amounts = [invoice.get("debit"), invoice.get("credit")]
    detail_amounts = [abs(parse_currency_amount(value)) for value in detail_amounts if parse_currency_amount(value) != 0]
    if detail_amounts:
        return max(detail_amounts)

    for candidate in [
        invoice.get("totalAmount"),
        invoice.get("amount"),
        invoice.get("invoiceAmount"),
        invoice.get("total"),
        invoice.get("amountDue"),
        invoice.get("total_due"),
        invoice.get("currentAmount"),
    ]:
        amount = abs(parse_currency_amount(candidate))
        if amount != 0:
            return amount
    return 0.0

def get_invoice_effective_date(invoice):
    return (
        parse_entrata_date(invoice.get("postDate"))
        or parse_entrata_date(invoice.get("transactionDate"))
        or parse_entrata_date(invoice.get("invoiceDate"))
        or parse_entrata_date(invoice.get("_date"))
    )

def get_invoice_key(invoice):
    stable_id = first_non_empty(
        invoice.get("@attributes", {}).get("id") if isinstance(invoice.get("@attributes"), dict) else None,
        invoice.get("id"),
        invoice.get("apDetailId"),
        invoice.get("reference"),
        invoice.get("memo"),
    )
    return str(stable_id) if stable_id not in (None, "") else json.dumps(invoice, sort_keys=True)

def get_month_range_for_date(date_value):
    month_start = date_value.replace(day=1)
    if month_start.month == 12:
        next_month = month_start.replace(year=month_start.year + 1, month=1, day=1)
    else:
        next_month = month_start.replace(month=month_start.month + 1, day=1)
    month_end = next_month - datetime.timedelta(days=1)
    return month_start, month_end

def get_invoice_allocation_month(invoice):
    post_month = str(invoice.get("postMonth") or "").strip()
    if post_month:
        try:
            month_dt = datetime.datetime.strptime(post_month, "%b, %Y").date()
            return get_month_range_for_date(month_dt)
        except ValueError:
            pass

    effective_date = get_invoice_effective_date(invoice)
    if effective_date:
        return get_month_range_for_date(effective_date)

    return None, None

def count_inclusive_days(start_date, end_date):
    return (end_date - start_date).days + 1

def get_invoice_breakdown_label(invoice):
    gl_account = invoice.get("glAccount", {}) if isinstance(invoice.get("glAccount"), dict) else {}
    account_number = gl_account.get("accountNumber")
    account_name = gl_account.get("accountName")
    vendor_name = first_non_empty(invoice.get("vendorName"), invoice.get("contract"), invoice.get("vendorCode"))
    account_label = " ".join([part for part in [account_number, account_name] if part])
    if vendor_name and account_label:
        return f"{account_label} - {vendor_name}"
    return account_label or vendor_name or "Unlabeled marketing cost"

def classify_invoice_channel(invoice):
    label = get_invoice_breakdown_label(invoice)
    classified = canonicalize_source_label(label, default_label="Other Marketing")
    return {
        "source_key": classified["source_key"],
        "source_label": classified["source_label"],
    }

def build_item_document_id(subcollection_name, item):
    for key in DOCUMENT_ID_CANDIDATES.get(subcollection_name, []):
        value = item.get(key)
        if value not in (None, ""):
            return str(value).replace("/", "_")
    return None

def get_property_portfolio(property_id):
    return PROPERTY_PORTFOLIO_BY_ID.get(str(property_id), "student")

def get_property_request_config(property_id):
    portfolio = get_property_portfolio(property_id)
    if portfolio == "multifamily":
        api_key = ENTRATA_MULTIFAMILY_API_KEY
        org_slug = ENTRATA_MULTIFAMILY_ORG_SLUG
    else:
        api_key = os.environ.get("ENTRATA_API_KEY")
        org_slug = ENTRATA_STUDENT_ORG_SLUG

    if not api_key:
        raise Exception(f"Missing Entrata API key for {portfolio} property {property_id}")

    return {
        "api_key": api_key,
        "org_slug": org_slug,
        "portfolio": portfolio,
    }

def make_entrata_request(
    method_name,
    endpoint,
    params,
    property_id,
    page_no=1,
    per_page=500,
    include_response_meta=False,
    include_pagination=True,
    method_version="r1",
):
    request_config = get_property_request_config(property_id)
    api_key = request_config["api_key"]

    base_url = f"https://apis.entrata.com/ext/orgs/{request_config['org_slug']}/{endpoint}"
    url = f"{base_url}?page_no={page_no}&per_page={per_page}" if include_pagination else base_url
    
    import base64
    api_key_stripped = api_key.strip()
    auth_str = base64.b64encode(("X-Api-Key:" + api_key_stripped).encode()).decode()
    
    # Use a dictionary for headers as required by requests
    headers = {
        "Content-Type": "APPLICATION/JSON; CHARSET=UTF-8",
        "X-Api-Key": api_key_stripped,
        "X-Send-pagination-Links": "1" if include_pagination else "0",
        "Authorization": "Basic " + auth_str,
        "User-Agent": "PostmanRuntime/7.39.1",
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
    }
    
    # Constructing the payload exactly as the user's example
    payload = {
        "auth": {"type": "apikey"},
        "requestId": "15",
        "method": {
            "name": method_name,
            "version": method_version,
            "params": params
        }
    }
    
    # Retry up to 3 times with exponential backoff for rate-limiting/SSL errors
    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = requests.post(
                url, 
                json=payload, 
                headers=headers, 
                timeout=60
            )
            response.raise_for_status()
            break  # Success, exit retry loop
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            if attempt < max_retries - 1:
                wait_time = 5 * (2 ** attempt)  # 5s, 10s, 20s
                print(f"Entrata connection error (attempt {attempt + 1}/{max_retries}), retrying in {wait_time}s: {str(e)}")
                time.sleep(wait_time)
            else:
                raise
        except requests.exceptions.HTTPError:
            raise
    
    try:
        data = response.json()
        
        if isinstance(data, list):
            if len(data) > 0: data = data[0]
            else: return {}
            
        parsed_response = data.get("response", {})
        if isinstance(parsed_response, list):
            if len(parsed_response) > 0: parsed_response = parsed_response[0]
            else: return {}
            
    except Exception as e:
        print(f"Entrata JSON Parse Error: {str(e)}")
        raise
    
    if include_response_meta:
        return parsed_response

    # Finally return the result object (where the actual data lives)
    return parsed_response.get("result", {})

def build_cors_response(body="", status=200, mimetype="text/plain"):
    return https_fn.Response(body, status=status, mimetype=mimetype, headers=CORS_HEADERS)

def coerce_metric_value(value):
    raw_value = getattr(value, "value", value)
    if raw_value in (None, ""):
        return 0

    raw_text = str(raw_value)
    if re.fullmatch(r"-?\d+", raw_text):
        try:
            return int(raw_text)
        except ValueError:
            return 0

    try:
        return float(raw_text)
    except ValueError:
        return raw_text

def build_event_name_filter(event_names):
    return FilterExpression(
        filter=Filter(
            field_name="eventName",
            in_list_filter=Filter.InListFilter(values=list(event_names), case_sensitive=False),
        )
    )

def build_path_contains_filter(field_name, value):
    return FilterExpression(
        filter=Filter(
            field_name=field_name,
            string_filter=Filter.StringFilter(
                value=value,
                match_type=Filter.StringFilter.MatchType.CONTAINS,
                case_sensitive=False,
            ),
        )
    )

def build_string_contains_filter(field_name, value):
    return FilterExpression(
        filter=Filter(
            field_name=field_name,
            string_filter=Filter.StringFilter(
                value=value,
                match_type=Filter.StringFilter.MatchType.CONTAINS,
                case_sensitive=False,
            ),
        )
    )

def combine_or_filters(filters):
    return FilterExpression(
        or_group=FilterExpressionList(expressions=filters)
    )

def build_metric_order_by(metric_name, desc=True):
    return OrderBy(
        metric=OrderBy.MetricOrderBy(metric_name=metric_name),
        desc=desc,
    )

def build_dimension_order_by(dimension_name, desc=False):
    return OrderBy(
        dimension=OrderBy.DimensionOrderBy(dimension_name=dimension_name),
        desc=desc,
    )

def run_ga4_report(
    client,
    ga4_property_id,
    start_date,
    end_date,
    dimensions,
    metrics,
    limit=100,
    dimension_filter=None,
    order_bys=None,
):
    request = RunReportRequest(
        property=f"properties/{ga4_property_id}",
        date_ranges=[AnalyticsDateRange(start_date=start_date.isoformat(), end_date=end_date.isoformat())],
        dimensions=[Dimension(name=name) for name in dimensions],
        metrics=[Metric(name=name) for name in metrics],
        limit=limit,
        dimension_filter=dimension_filter,
        order_bys=order_bys or [],
    )
    response = client.run_report(request)
    rows = []

    for row in response.rows:
        row_dimensions = {
            name: value.value
            for name, value in zip(dimensions, row.dimension_values)
        }
        row_metrics = {
            name: coerce_metric_value(value)
            for name, value in zip(metrics, row.metric_values)
        }
        rows.append({
            "dimensions": row_dimensions,
            "metrics": row_metrics,
        })

    return rows

def build_funnel_or_group(expressions):
    return FunnelFilterExpression(
        or_group=FunnelFilterExpressionList(expressions=expressions)
    )

def build_funnel_and_group(expressions):
    return FunnelFilterExpression(
        and_group=FunnelFilterExpressionList(expressions=expressions)
    )

def build_funnel_event_expression(event_names):
    values = list(event_names) if isinstance(event_names, (list, tuple, set)) else [event_names]
    if len(values) == 1:
        return FunnelFilterExpression(
            funnel_event_filter=FunnelEventFilter(event_name=values[0])
        )
    return build_funnel_or_group([
        FunnelFilterExpression(funnel_event_filter=FunnelEventFilter(event_name=value))
        for value in values
    ])

def build_funnel_field_exact_expression(field_name, value):
    return FunnelFilterExpression(
        funnel_field_filter=FunnelFieldFilter(
            field_name=field_name,
            string_filter=FunnelStringFilter(
                match_type=FunnelStringFilter.MatchType.EXACT,
                value=value,
                case_sensitive=False,
            ),
        )
    )

def build_page_view_step(step_name, page_path):
    return AnalyticsFunnelStep(
        name=step_name,
        filter_expression=build_funnel_and_group([
            build_funnel_event_expression("page_view"),
            build_funnel_field_exact_expression("pagePathPlusQueryString", page_path),
        ]),
    )

def run_ga4_funnel_next_actions(
    client,
    ga4_property_id,
    start_date,
    end_date,
    steps,
    next_action_dimension="pagePathPlusQueryString",
    limit=8,
):
    request = RunFunnelReportRequest(
        property=f"properties/{ga4_property_id}",
        date_ranges=[FunnelDateRange(start_date=start_date.isoformat(), end_date=end_date.isoformat())],
        funnel=AnalyticsFunnel(steps=steps),
        funnel_next_action=FunnelNextAction(
            next_action_dimension=FunnelDimension(name=next_action_dimension),
            limit=limit,
        ),
        limit=limit,
    )
    response = client.run_funnel_report(request)
    visualization = getattr(response, "funnel_visualization", None)
    if not visualization:
        return []

    dimension_headers = [header.name for header in visualization.dimension_headers]
    metric_headers = [header.name for header in visualization.metric_headers]
    target_step_name = steps[-1].name if steps else None
    rows = []

    for row in visualization.rows:
        dimensions = {
            name: value.value
            for name, value in zip(dimension_headers, row.dimension_values)
        }
        metrics = {
            name: coerce_metric_value(value)
            for name, value in zip(metric_headers, row.metric_values)
        }
        step_name = dimensions.get("funnelStepName", "")
        if target_step_name and step_name not in {target_step_name, f"1. {target_step_name}", f"2. {target_step_name}", f"3. {target_step_name}"} and not step_name.endswith(target_step_name):
            continue
        next_action = dimensions.get("funnelStepNextAction")
        if not next_action or next_action == "RESERVED_TOTAL":
            continue
        rows.append({
            "label": next_action,
            "activeUsers": float(metrics.get("activeUsers", 0) or 0),
        })

    rows.sort(key=lambda item: item["activeUsers"], reverse=True)
    return rows[:limit]

def sum_metric(rows, metric_name):
    total = 0
    for row in rows:
        total += float(row.get("metrics", {}).get(metric_name, 0) or 0)
    return total

def average_metric(rows, metric_name):
    if not rows:
        return None
    return sum_metric(rows, metric_name) / len(rows)

def compute_change(current_value, previous_value):
    if previous_value in (None, 0):
        return None
    try:
        return round((float(current_value) - float(previous_value)) / float(previous_value), 4)
    except (TypeError, ValueError, ZeroDivisionError):
        return None

def strip_non_digits(value):
    return re.sub(r"\D+", "", str(value or ""))

def micros_to_currency(value):
    if value in (None, ""):
        return 0.0
    try:
        return round(float(value) / 1_000_000, 2)
    except (TypeError, ValueError):
        return 0.0

def normalize_google_ads_ctr(value):
    if value in (None, ""):
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return round(numeric / 100, 4) if numeric > 1 else round(numeric, 4)

def google_ads_attr(value, path, default=None):
    current = value
    for part in path.split("."):
        if current is None:
            return default
        if not hasattr(current, part):
            return default
        current = getattr(current, part)
    return current if current is not None else default

def google_ads_enum_name(value):
    if value is None:
        return None
    name = getattr(value, "name", None)
    if name:
        return name
    return str(value).split(".")[-1]

def extract_ad_text_assets(assets):
    items = []
    for asset in assets or []:
        text = google_ads_attr(asset, "text")
        if text:
            items.append(text)
    return items

def first_final_url(ad_row):
    urls = google_ads_attr(ad_row, "ad_group_ad.ad.final_urls", []) or []
    return urls[0] if urls else None

def build_display_url(final_url, path1=None, path2=None):
    if not final_url:
        return None
    try:
        parsed = urlparse(final_url)
    except Exception:
        return final_url
    display = parsed.netloc.replace("www.", "")
    segments = [segment for segment in [path1, path2] if segment]
    if segments:
        display = f"{display}/{'/'.join(segments)}"
    return display

def build_google_ads_brand_terms(property_name):
    normalized_name = re.sub(r"[^a-z0-9]+", " ", str(property_name or "").lower()).strip()
    terms = set()
    if normalized_name:
        terms.add(normalized_name)
        for token in normalized_name.split():
            if len(token) >= 4 and token not in COMMON_PROPERTY_TERMS:
                terms.add(token)
    return sorted(terms)

def classify_google_ads_branding(text, brand_terms):
    normalized_text = re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).strip()
    if not normalized_text or not brand_terms:
        return "nonBrand"
    return "brand" if any(term in normalized_text for term in brand_terms) else "nonBrand"

def build_google_ads_client():
    config_json = os.environ.get("GOOGLE_ADS_CONFIG_JSON")
    if not config_json:
        raise ValueError("Google Ads credentials are not configured. Set GOOGLE_ADS_CONFIG_JSON to enable paid search reporting.")

    try:
        config = json.loads(config_json)
    except json.JSONDecodeError as exc:
        raise ValueError("GOOGLE_ADS_CONFIG_JSON is not valid JSON.") from exc

    from google.ads.googleads.client import GoogleAdsClient

    config.setdefault("use_proto_plus", True)
    return GoogleAdsClient.load_from_dict(config)

def normalize_meta_ads_account_id(value):
    raw_value = str(value or "").strip()
    if not raw_value:
        return ""
    digits = strip_non_digits(raw_value)
    if not digits:
        return raw_value
    return f"act_{digits}"

def build_meta_ads_config():
    access_token = os.environ.get("META_ACCESS_TOKEN")
    if not access_token:
        raise ValueError("Meta Ads credentials are not configured. Set META_ACCESS_TOKEN to enable paid social reporting.")
    graph_version = os.environ.get("META_GRAPH_API_VERSION", "v22.0").strip() or "v22.0"
    active_statuses = [
        item.strip().upper()
        for item in os.environ.get("META_ACTIVE_CAMPAIGN_STATUSES", "ACTIVE").split(",")
        if item.strip()
    ]
    return {
        "access_token": access_token,
        "graph_version": graph_version,
        "active_statuses": active_statuses or ["ACTIVE"],
    }

def resolve_meta_ads_attribution_config(mode):
    normalized_mode = str(mode or "account_default").strip().lower() or "account_default"
    if normalized_mode == "1d_click":
        return {
            "mode": "1d_click",
            "label": "1-day click",
            "use_account_attribution_setting": "false",
            "action_attribution_windows": ["1d_click"],
        }
    if normalized_mode == "7d_click_1d_view":
        return {
            "mode": "7d_click_1d_view",
            "label": "7-day click / 1-day view",
            "use_account_attribution_setting": "false",
            "action_attribution_windows": ["7d_click", "1d_view"],
        }
    return {
        "mode": "account_default",
        "label": "Account default",
        "use_account_attribution_setting": "true",
        "action_attribution_windows": None,
    }

def build_meta_ads_cache_key(meta_ads_account_id, current_start, current_end, attribution_mode, campaign_ids, match_terms):
    payload = {
        "account": normalize_meta_ads_account_id(meta_ads_account_id),
        "start": current_start,
        "end": current_end,
        "attribution": attribution_mode,
        "campaign_ids": sorted(parse_meta_match_list(campaign_ids)),
        "match_terms": sorted(parse_meta_match_list(match_terms)),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()

def meta_ads_api_get(config, path, params=None):
    url = f"https://graph.facebook.com/{config['graph_version']}/{path.lstrip('/')}"
    query_params = {"access_token": config["access_token"], **(params or {})}
    items = []
    while url:
        response = requests.get(url, params=query_params, timeout=60)
        payload = response.json()
        if response.status_code >= 400 or payload.get("error"):
            error_payload = payload.get("error", payload)
            message = error_payload.get("message") if isinstance(error_payload, dict) else str(error_payload)
            raise ValueError(f"Meta Ads API request failed: {message}")
        items.extend(payload.get("data", []))
        paging = payload.get("paging", {}) if isinstance(payload, dict) else {}
        url = paging.get("next")
        query_params = None
    return items

def meta_ads_api_get_object(config, path, params=None):
    url = f"https://graph.facebook.com/{config['graph_version']}/{path.lstrip('/')}"
    query_params = {"access_token": config["access_token"], **(params or {})}
    response = requests.get(url, params=query_params, timeout=60)
    payload = response.json()
    if response.status_code >= 400 or payload.get("error"):
        error_payload = payload.get("error", payload)
        message = error_payload.get("message") if isinstance(error_payload, dict) else str(error_payload)
        raise ValueError(f"Meta Ads API request failed: {message}")
    return payload if isinstance(payload, dict) else {}

META_RESULT_ACTION_PRIORITIES = [
    "onsite_conversion.lead_grouped",
    "lead",
    "omni_lead",
    "offsite_conversion.fb_pixel_lead",
    "offsite_conversion.custom",
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
    "complete_registration",
    "contact_total",
    "landing_page_view",
]
META_LINK_CLICK_ACTION_TYPES = ["link_click", "inline_link_click", "onsite_web_click"]
META_OUTBOUND_CLICK_ACTION_TYPES = ["outbound_click"]
META_LANDING_PAGE_VIEW_ACTION_TYPES = ["landing_page_view"]

def coerce_meta_number(value):
    if value in (None, ""):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        normalized = value.replace(",", "").strip()
        try:
            return float(normalized)
        except ValueError:
            return 0.0
    return 0.0

def build_meta_action_map(items):
    action_map = {}
    for item in items or []:
        if not isinstance(item, dict):
            continue
        action_type = str(item.get("action_type") or "").strip()
        if not action_type:
            continue
        action_map[action_type] = action_map.get(action_type, 0.0) + coerce_meta_number(item.get("value"))
    return action_map

def get_meta_action_total(action_map, action_types):
    total = 0.0
    for action_type in action_types:
        total += coerce_meta_number(action_map.get(action_type))
    return total

def extract_meta_primary_result(action_map):
    for action_type in META_RESULT_ACTION_PRIORITIES:
        value = coerce_meta_number(action_map.get(action_type))
        if value > 0:
            return action_type, value
    return None, 0.0

def extract_meta_fixed_key_metrics(action_map, outbound_click_total=0.0):
    lead_total = 0.0
    for action_type in [
        "onsite_conversion.lead_grouped",
        "lead",
        "omni_lead",
        "offsite_conversion.fb_pixel_lead",
        "offsite_complete_registration_add_meta_leads",
        "offsite_search_add_meta_leads",
        "offsite_content_view_add_meta_leads",
    ]:
        lead_total += coerce_meta_number(action_map.get(action_type))
    landing_page_views = get_meta_action_total(action_map, META_LANDING_PAGE_VIEW_ACTION_TYPES)
    link_clicks = get_meta_action_total(action_map, META_LINK_CLICK_ACTION_TYPES)
    outbound_clicks = max(outbound_click_total, get_meta_action_total(action_map, META_OUTBOUND_CLICK_ACTION_TYPES))
    return {
        "leads": round(lead_total, 2) if lead_total > 0 else 0.0,
        "landingPageViews": round(landing_page_views, 2) if landing_page_views > 0 else 0.0,
        "linkClicks": round(link_clicks, 2) if link_clicks > 0 else 0.0,
        "outboundClicks": round(outbound_clicks, 2) if outbound_clicks > 0 else 0.0,
    }

def format_meta_result_label(action_type):
    if not action_type:
        return None
    return action_type.replace(".", " ").replace("_", " ").title()

def normalize_meta_metric_row(row):
    action_map = build_meta_action_map(row.get("actions"))
    action_value_map = build_meta_action_map(row.get("action_values"))
    cost_per_action_map = build_meta_action_map(row.get("cost_per_action_type"))
    outbound_click_map = build_meta_action_map(row.get("outbound_clicks"))

    impressions = int(coerce_meta_number(row.get("impressions")))
    clicks = int(coerce_meta_number(row.get("clicks")))
    spend = coerce_meta_number(row.get("spend"))
    frequency = coerce_meta_number(row.get("frequency"))
    ctr = coerce_meta_number(row.get("ctr"))
    cpc = coerce_meta_number(row.get("cpc"))
    cpm = coerce_meta_number(row.get("cpm"))

    result_action_type, results = extract_meta_primary_result(action_map)
    link_clicks = get_meta_action_total(action_map, META_LINK_CLICK_ACTION_TYPES)
    outbound_clicks = get_meta_action_total(outbound_click_map, META_OUTBOUND_CLICK_ACTION_TYPES)
    if outbound_clicks <= 0:
        outbound_clicks = get_meta_action_total(action_map, META_OUTBOUND_CLICK_ACTION_TYPES)
    landing_page_views = get_meta_action_total(action_map, META_LANDING_PAGE_VIEW_ACTION_TYPES)

    cost_per_result = coerce_meta_number(cost_per_action_map.get(result_action_type)) if result_action_type else 0.0
    if cost_per_result <= 0 and results > 0:
        cost_per_result = spend / results
    key_metrics = extract_meta_fixed_key_metrics(action_map, outbound_click_total=outbound_clicks)

    sorted_actions = sorted(
        (
            {
                "actionType": action_type,
                "label": format_meta_result_label(action_type),
                "value": round(value, 2),
                "actionValue": round(coerce_meta_number(action_value_map.get(action_type)), 2),
                "costPerAction": round(coerce_meta_number(cost_per_action_map.get(action_type)), 2) or None,
            }
            for action_type, value in action_map.items()
            if value > 0
        ),
        key=lambda item: item["value"],
        reverse=True,
    )

    return {
        "impressions": impressions,
        "clicks": clicks,
        "spend": round(spend, 2),
        "ctr": round(ctr / 100, 4) if ctr > 1 else (round(ctr, 4) if ctr > 0 else None),
        "cpc": round(cpc, 2) if cpc > 0 else (round(spend / clicks, 2) if clicks > 0 else None),
        "cpm": round(cpm, 2) if cpm > 0 else (round((spend / impressions) * 1000, 2) if impressions > 0 else None),
        "frequency": round(frequency, 2) if frequency > 0 else None,
        "results": round(results, 2) if results > 0 else 0.0,
        "resultLabel": format_meta_result_label(result_action_type),
        "resultActionType": result_action_type,
        "costPerResult": round(cost_per_result, 2) if cost_per_result > 0 else None,
        "linkClicks": key_metrics["linkClicks"],
        "outboundClicks": key_metrics["outboundClicks"],
        "landingPageViews": key_metrics["landingPageViews"],
        "leads": key_metrics["leads"],
        "keyMetrics": key_metrics,
        "actions": sorted_actions[:10],
        "actionValues": {
            action_type: round(value, 2)
            for action_type, value in action_value_map.items()
            if value > 0
        },
    }

def summarize_meta_ads_totals(rows):
    totals = {
        "impressions": 0,
        "clicks": 0,
        "spend": 0.0,
        "frequencyNumerator": 0.0,
        "frequencyDenominator": 0.0,
        "actions": {},
        "actionValues": {},
        "costPerActionTotals": {},
        "outboundClicks": 0.0,
    }
    for row in rows:
        normalized = normalize_meta_metric_row(row)
        totals["impressions"] += normalized["impressions"]
        totals["clicks"] += normalized["clicks"]
        totals["spend"] += normalized["spend"]
        if normalized["frequency"] is not None and normalized["impressions"] > 0:
            totals["frequencyNumerator"] += normalized["frequency"] * normalized["impressions"]
            totals["frequencyDenominator"] += normalized["impressions"]
        for action in normalized["actions"]:
            action_type = action["actionType"]
            totals["actions"][action_type] = totals["actions"].get(action_type, 0.0) + coerce_meta_number(action["value"])
            if action.get("actionValue") not in (None, 0):
                totals["actionValues"][action_type] = totals["actionValues"].get(action_type, 0.0) + coerce_meta_number(action["actionValue"])
            if action.get("costPerAction") not in (None, 0):
                totals["costPerActionTotals"].setdefault(action_type, {"cost": 0.0, "actions": 0.0})
                totals["costPerActionTotals"][action_type]["actions"] += coerce_meta_number(action["value"])
        totals["outboundClicks"] += normalized["outboundClicks"]

    result_action_type, results = extract_meta_primary_result(totals["actions"])
    cost_per_result = None
    if result_action_type and results > 0:
        cost_per_result = round(totals["spend"] / results, 2)

    ctr = round(totals["clicks"] / totals["impressions"], 4) if totals["impressions"] > 0 else None
    cpc = round(totals["spend"] / totals["clicks"], 2) if totals["clicks"] > 0 else None
    cpm = round((totals["spend"] / totals["impressions"]) * 1000, 2) if totals["impressions"] > 0 else None
    frequency = (
        round(totals["frequencyNumerator"] / totals["frequencyDenominator"], 2)
        if totals["frequencyDenominator"] > 0 else None
    )
    link_clicks = get_meta_action_total(totals["actions"], META_LINK_CLICK_ACTION_TYPES)
    landing_page_views = get_meta_action_total(totals["actions"], META_LANDING_PAGE_VIEW_ACTION_TYPES)
    key_metrics = extract_meta_fixed_key_metrics(totals["actions"], outbound_click_total=totals["outboundClicks"])

    return {
        "impressions": totals["impressions"],
        "clicks": totals["clicks"],
        "spend": round(totals["spend"], 2),
        "ctr": ctr,
        "cpc": cpc,
        "cpm": cpm,
        "frequency": frequency,
        "results": round(results, 2) if results > 0 else 0.0,
        "resultLabel": format_meta_result_label(result_action_type),
        "resultActionType": result_action_type,
        "costPerResult": cost_per_result,
        "linkClicks": key_metrics["linkClicks"],
        "outboundClicks": key_metrics["outboundClicks"],
        "landingPageViews": key_metrics["landingPageViews"],
        "leads": key_metrics["leads"],
        "keyMetrics": key_metrics,
        "actions": sorted(
            (
                {
                    "actionType": action_type,
                    "label": format_meta_result_label(action_type),
                    "value": round(value, 2),
                    "actionValue": round(coerce_meta_number(totals["actionValues"].get(action_type)), 2) if coerce_meta_number(totals["actionValues"].get(action_type)) > 0 else None,
                }
                for action_type, value in totals["actions"].items()
                if value > 0
            ),
            key=lambda item: item["value"],
            reverse=True,
        )[:10],
        "actionValues": {
            action_type: round(value, 2)
            for action_type, value in totals["actionValues"].items()
            if value > 0
        },
    }

def aggregate_meta_ads_daily_rows(rows):
    aggregated = {}
    for row in rows:
        date_value = row.get("date_start") or row.get("date") or row.get("dateStop")
        if not date_value:
            continue
        bucket = aggregated.setdefault(date_value, [])
        bucket.append(row)

    items = []
    for date_value in sorted(aggregated.keys()):
        totals = summarize_meta_ads_totals(aggregated[date_value])
        items.append({
            "date": date_value,
            **totals,
        })
    return items

def fetch_meta_ads_campaigns(config, meta_ads_account_id):
    return meta_ads_api_get(
        config,
        f"{normalize_meta_ads_account_id(meta_ads_account_id)}/campaigns",
        {
            "fields": "id,name,status,effective_status,objective",
            "effective_status": json.dumps(config["active_statuses"]),
            "limit": 200,
        },
    )

def fetch_meta_ads_insights(
    config,
    meta_ads_account_id,
    start_date,
    end_date,
    campaign_ids=None,
    time_increment=None,
    level="campaign",
    fields=None,
    breakdowns=None,
    attribution_config=None,
):
    params = {
        "level": level,
        "fields": ",".join(fields or [
            "campaign_id",
            "campaign_name",
            "date_start",
            "impressions",
            "clicks",
            "spend",
            "cpm",
            "cpc",
            "ctr",
            "frequency",
            "actions",
            "action_values",
            "cost_per_action_type",
            "outbound_clicks",
        ]),
        "time_range": json.dumps({"since": start_date, "until": end_date}),
        "limit": 200,
    }
    if time_increment:
        params["time_increment"] = str(time_increment)
    if breakdowns:
        params["breakdowns"] = ",".join(breakdowns)
    attribution_config = attribution_config or resolve_meta_ads_attribution_config(None)
    params["use_account_attribution_setting"] = attribution_config["use_account_attribution_setting"]
    if attribution_config.get("action_attribution_windows"):
        params["action_attribution_windows"] = json.dumps(attribution_config["action_attribution_windows"])
    if campaign_ids:
        params["filtering"] = json.dumps([
            {
                "field": "campaign.id",
                "operator": "IN",
                "value": [str(campaign_id) for campaign_id in campaign_ids],
            }
        ])
    return meta_ads_api_get(
        config,
        f"{normalize_meta_ads_account_id(meta_ads_account_id)}/insights",
        params,
    )

def parse_meta_match_list(value):
    if value in (None, ""):
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
        return [item.strip() for item in value.split(",") if item.strip()]
    return []

def filter_meta_ads_campaigns_for_property(campaigns, property_name, campaign_ids=None, match_terms=None):
    requested_ids = {str(item) for item in parse_meta_match_list(campaign_ids)}
    if requested_ids:
        return [campaign for campaign in campaigns if str(campaign.get("id") or "") in requested_ids]

    explicit_terms = parse_meta_match_list(match_terms)
    if explicit_terms:
        normalized_terms = [re.sub(r"[^a-z0-9]+", " ", term.lower()).strip() for term in explicit_terms if term]
    else:
        normalized_terms = build_google_ads_brand_terms(property_name)
    if not normalized_terms:
        return []

    filtered = []
    for campaign in campaigns:
        campaign_name = re.sub(r"[^a-z0-9]+", " ", str(campaign.get("name") or "").lower()).strip()
        if any(term and term in campaign_name for term in normalized_terms):
            filtered.append(campaign)
    return filtered

def build_meta_ads_entity_rows(rows, id_key, name_key, extra_fields=None):
    previous = []
    items = []
    for row in rows:
        metrics = normalize_meta_metric_row(row)
        item = {
            "id": str(row.get(id_key) or ""),
            "name": row.get(name_key) or "(not set)",
            **metrics,
        }
        for field_name in extra_fields or []:
            item[field_name] = row.get(field_name)
        items.append(item)
    items.sort(key=lambda item: item.get("spend", 0), reverse=True)
    return items

def build_meta_ads_campaign_rows(campaigns, current_rows, previous_rows):
    current_map = {
        str(row.get("campaign_id") or ""): normalize_meta_metric_row(row)
        for row in current_rows
    }
    previous_map = {
        str(row.get("campaign_id") or ""): normalize_meta_metric_row(row)
        for row in previous_rows
    }
    items = []
    for campaign in campaigns:
        campaign_id = str(campaign.get("id") or "")
        current_metrics = current_map.get(campaign_id, summarize_meta_ads_totals([]))
        previous_metrics = previous_map.get(campaign_id, summarize_meta_ads_totals([]))
        items.append({
            "campaignId": campaign_id,
            "campaignName": campaign.get("name") or "(not set)",
            "status": campaign.get("status"),
            "effectiveStatus": campaign.get("effective_status"),
            "objective": campaign.get("objective"),
            "current": current_metrics,
            "previous": previous_metrics,
            "delta": {
                "clicks": compute_change(current_metrics.get("clicks", 0), previous_metrics.get("clicks", 0)),
                "spend": compute_change(current_metrics.get("spend", 0), previous_metrics.get("spend", 0)),
                "impressions": compute_change(current_metrics.get("impressions", 0), previous_metrics.get("impressions", 0)),
                "results": compute_change(current_metrics.get("results", 0), previous_metrics.get("results", 0)),
            },
        })
    items.sort(key=lambda item: item.get("current", {}).get("spend", 0), reverse=True)
    return items

def build_meta_ads_placement_rows(rows):
    grouped = {}
    for row in rows:
        key = (
            row.get("publisher_platform") or "(not set)",
            row.get("platform_position") or "(not set)",
            row.get("impression_device") or "(not set)",
        )
        grouped.setdefault(key, []).append(row)

    items = []
    for (publisher_platform, platform_position, impression_device), bucket_rows in grouped.items():
        totals = summarize_meta_ads_totals(bucket_rows)
        items.append({
            "publisherPlatform": publisher_platform,
            "platformPosition": platform_position,
            "impressionDevice": impression_device,
            **totals,
        })
    items.sort(key=lambda item: item.get("spend", 0), reverse=True)
    return items

def extract_meta_creative_preview_fields(creative):
    creative = creative or {}
    story_spec = creative.get("object_story_spec") or {}
    link_data = story_spec.get("link_data") or {}
    video_data = story_spec.get("video_data") or {}
    template_data = story_spec.get("template_data") or {}
    page_id = story_spec.get("page_id")
    child_attachments = link_data.get("child_attachments") or template_data.get("child_attachments") or []

    primary_text = (
        link_data.get("message")
        or video_data.get("message")
        or template_data.get("message")
        or creative.get("body")
    )
    headline = (
        link_data.get("name")
        or video_data.get("title")
        or template_data.get("name")
        or creative.get("title")
    )
    description = (
        link_data.get("description")
        or template_data.get("description")
    )
    call_to_action = (
        ((link_data.get("call_to_action") or {}).get("type"))
        or ((video_data.get("call_to_action") or {}).get("type"))
        or ((template_data.get("call_to_action") or {}).get("type"))
        or creative.get("call_to_action_type")
    )
    destination_url = (
        link_data.get("link")
        or ((video_data.get("call_to_action") or {}).get("value") or {}).get("link")
        or ((template_data.get("call_to_action") or {}).get("value") or {}).get("link")
    )
    media_url = creative.get("image_url") or creative.get("thumbnail_url")
    format_type = "image"
    if child_attachments:
        format_type = "carousel"
    elif video_data:
        format_type = "video"
    elif link_data:
        format_type = "image"

    carousel_cards = []
    for attachment in child_attachments[:10]:
        carousel_cards.append({
            "headline": attachment.get("name"),
            "description": attachment.get("description"),
            "destinationUrl": attachment.get("link"),
            "mediaUrl": attachment.get("picture"),
        })

    return {
        "pageId": page_id,
        "pageName": None,
        "primaryText": primary_text,
        "headline": headline,
        "description": description,
        "callToAction": call_to_action,
        "mediaUrl": media_url,
        "destinationUrl": destination_url,
        "format": format_type,
        "carouselCards": carousel_cards,
    }

def fetch_meta_page_names(config, page_ids):
    names = {}
    for page_id in sorted({str(item).strip() for item in page_ids if str(item).strip()}):
        try:
            page_data = meta_ads_api_get_object(config, page_id, {"fields": "name"})
            if isinstance(page_data, dict) and page_data.get("name"):
                names[page_id] = page_data.get("name")
        except Exception:
            continue
    return names

def fetch_meta_ads_active_ads(config, meta_ads_account_id, campaign_ids=None):
    params = {
        "fields": ",".join([
            "id",
            "name",
            "status",
            "effective_status",
            "campaign{id,name}",
            "adset{id,name}",
            "creative{id,name,thumbnail_url,image_url,object_story_spec,body,title,call_to_action_type,asset_feed_spec}",
        ]),
        "limit": 100,
        "effective_status": json.dumps(["ACTIVE"]),
    }
    if campaign_ids:
        params["filtering"] = json.dumps([
            {
                "field": "campaign.id",
                "operator": "IN",
                "value": [str(campaign_id) for campaign_id in campaign_ids],
            }
        ])
    return meta_ads_api_get(
        config,
        f"{normalize_meta_ads_account_id(meta_ads_account_id)}/ads",
        params,
    )

def build_meta_ads_preview_rows(config, ad_entities, ad_rows):
    entity_map = {
        str(item.get("id") or ""): item
        for item in ad_entities
    }
    page_ids = []
    for item in ad_entities:
        creative = (item or {}).get("creative") or {}
        preview = extract_meta_creative_preview_fields(creative)
        if preview.get("pageId"):
            page_ids.append(preview.get("pageId"))
    page_name_map = fetch_meta_page_names(config, page_ids)

    items = []
    for row in ad_rows:
        ad_id = str(row.get("ad_id") or "")
        metrics = normalize_meta_metric_row(row)
        ad_entity = entity_map.get(ad_id, {})
        creative = ad_entity.get("creative") or {}
        preview = extract_meta_creative_preview_fields(creative)
        preview["pageName"] = page_name_map.get(preview.get("pageId")) or preview.get("pageName")
        items.append({
            "adId": ad_id,
            "adName": row.get("ad_name") or ad_entity.get("name") or "(not set)",
            "campaignName": row.get("campaign_name") or ((ad_entity.get("campaign") or {}).get("name")) or "(not set)",
            "adSetName": row.get("adset_name") or ((ad_entity.get("adset") or {}).get("name")) or "(not set)",
            **metrics,
            **preview,
        })
    items.sort(key=lambda item: item.get("spend", 0), reverse=True)
    return items

def fetch_meta_ads_dashboard_payload(
    property_id,
    meta_ads_account_id,
    property_name=None,
    match_terms=None,
    campaign_ids=None,
    attribution_mode=None,
    start_date_value=None,
    end_date_value=None,
    default_days=90,
):
    if not meta_ads_account_id:
        raise ValueError("Missing required parameter: meta_ads_account_id")

    config = build_meta_ads_config()
    window = resolve_reporting_window(start_date_value, end_date_value, default_days=default_days)
    current_start = window["current_start"].isoformat()
    current_end = window["current_end"].isoformat()
    previous_start = window["previous_start"].isoformat()
    previous_end = window["previous_end"].isoformat()
    normalized_account_id = normalize_meta_ads_account_id(meta_ads_account_id)
    requested_campaign_ids = parse_meta_match_list(campaign_ids)
    requested_match_terms = parse_meta_match_list(match_terms)
    attribution_config = resolve_meta_ads_attribution_config(attribution_mode)

    campaigns = fetch_meta_ads_campaigns(config, normalized_account_id)
    campaigns = filter_meta_ads_campaigns_for_property(campaigns, property_name, campaign_ids=requested_campaign_ids, match_terms=requested_match_terms)
    campaign_ids = [str(item.get("id")) for item in campaigns if item.get("id")]
    if not campaign_ids:
        empty_totals = summarize_meta_ads_totals([])
        return {
            "propertyId": str(property_id),
            "metaAdsAccountId": normalized_account_id,
            "window": {
                "days": window["days"],
                "current": {"startDate": current_start, "endDate": current_end},
                "previous": {"startDate": previous_start, "endDate": previous_end},
            },
            "Scoping": {
                "matchedCampaignIds": [],
                "matchedBy": {
                    "campaignIds": requested_campaign_ids,
                    "matchTerms": requested_match_terms,
                    "propertyName": property_name,
                },
                "strict": True,
                "note": "No active Meta campaigns matched this property, so the dashboard returns an empty result instead of account-wide data.",
            },
            "Attribution": attribution_config,
            "Overview": {
                "current": empty_totals,
                "previous": empty_totals,
                "delta": {"clicks": None, "spend": None, "impressions": None, "results": None},
            },
            "Campaigns": [],
            "AdSets": {"items": []},
            "Placements": {"items": []},
            "Ads": {"topAds": [], "dailyPerformance": []},
            "Coverage": {
                "included": [
                    "Strict property scoping for active campaigns",
                    "Campaign-level impressions, clicks, spend, CTR, CPC, CPM, results, and funnel actions",
                    "Daily paid social performance trend for the selected range",
                ],
                "remaining": [
                    "Explicit property-owned campaign mappings for every asset",
                    "Creative previews for properties without active ads",
                ],
            },
        }

    overview_current_rows = fetch_meta_ads_insights(
        config,
        normalized_account_id,
        current_start,
        current_end,
        campaign_ids=campaign_ids,
        level="account",
        attribution_config=attribution_config,
    )
    overview_previous_rows = fetch_meta_ads_insights(
        config,
        normalized_account_id,
        previous_start,
        previous_end,
        campaign_ids=campaign_ids,
        level="account",
        attribution_config=attribution_config,
    )
    current_rows = fetch_meta_ads_insights(config, normalized_account_id, current_start, current_end, campaign_ids=campaign_ids, attribution_config=attribution_config)
    previous_rows = fetch_meta_ads_insights(config, normalized_account_id, previous_start, previous_end, campaign_ids=campaign_ids, attribution_config=attribution_config)
    daily_rows = fetch_meta_ads_insights(config, normalized_account_id, current_start, current_end, campaign_ids=campaign_ids, time_increment=1, attribution_config=attribution_config)
    adset_rows = fetch_meta_ads_insights(
        config,
        normalized_account_id,
        current_start,
        current_end,
        campaign_ids=campaign_ids,
        level="adset",
        attribution_config=attribution_config,
        fields=[
            "campaign_name",
            "adset_id",
            "adset_name",
            "impressions",
            "clicks",
            "spend",
            "cpm",
            "cpc",
            "ctr",
            "frequency",
            "actions",
            "action_values",
            "cost_per_action_type",
            "outbound_clicks",
        ],
    )
    placement_rows = fetch_meta_ads_insights(
        config,
        normalized_account_id,
        current_start,
        current_end,
        campaign_ids=campaign_ids,
        level="adset",
        attribution_config=attribution_config,
        fields=[
            "campaign_name",
            "adset_name",
            "impressions",
            "clicks",
            "spend",
            "cpm",
            "cpc",
            "ctr",
            "frequency",
            "actions",
            "action_values",
            "cost_per_action_type",
            "outbound_clicks",
        ],
        breakdowns=["publisher_platform", "platform_position", "impression_device"],
    )
    ad_rows = fetch_meta_ads_insights(
        config,
        normalized_account_id,
        current_start,
        current_end,
        campaign_ids=campaign_ids,
        level="ad",
        attribution_config=attribution_config,
        fields=[
            "campaign_name",
            "adset_name",
            "ad_id",
            "ad_name",
            "impressions",
            "clicks",
            "spend",
            "cpm",
            "cpc",
            "ctr",
            "frequency",
            "actions",
            "action_values",
            "cost_per_action_type",
            "outbound_clicks",
        ],
    )
    active_ads = fetch_meta_ads_active_ads(config, normalized_account_id, campaign_ids=campaign_ids)

    overview_current = summarize_meta_ads_totals(overview_current_rows)
    overview_previous = summarize_meta_ads_totals(overview_previous_rows)
    ad_set_items = build_meta_ads_entity_rows(adset_rows, "adset_id", "adset_name", extra_fields=["campaign_name"])
    placement_items = build_meta_ads_placement_rows(placement_rows)
    preview_rows = build_meta_ads_preview_rows(config, active_ads, ad_rows)
    preview_rows = [item for item in preview_rows if item.get("spend", 0) > 0][:8]

    return {
        "propertyId": str(property_id),
        "metaAdsAccountId": normalized_account_id,
        "window": {
            "days": window["days"],
            "current": {"startDate": current_start, "endDate": current_end},
            "previous": {"startDate": previous_start, "endDate": previous_end},
        },
        "Scoping": {
            "matchedCampaignIds": campaign_ids,
            "matchedBy": {
                "campaignIds": requested_campaign_ids,
                "matchTerms": requested_match_terms,
                "propertyName": property_name,
            },
            "strict": True,
            "note": "Only active campaigns matching this property are included.",
        },
        "Attribution": attribution_config,
        "Overview": {
            "current": overview_current,
            "previous": overview_previous,
            "delta": {
                "clicks": compute_change(overview_current.get("clicks", 0), overview_previous.get("clicks", 0)),
                "spend": compute_change(overview_current.get("spend", 0), overview_previous.get("spend", 0)),
                "impressions": compute_change(overview_current.get("impressions", 0), overview_previous.get("impressions", 0)),
                "results": compute_change(overview_current.get("results", 0), overview_previous.get("results", 0)),
            },
        },
        "Campaigns": [item for item in build_meta_ads_campaign_rows(campaigns, current_rows, previous_rows) if item.get("current", {}).get("spend", 0) > 0],
        "AdSets": {
            "items": [item for item in ad_set_items if item.get("spend", 0) > 0],
        },
        "Placements": {
            "items": [item for item in placement_items if item.get("spend", 0) > 0],
        },
        "Ads": {
            "topAds": preview_rows,
            "dailyPerformance": aggregate_meta_ads_daily_rows(daily_rows),
        },
        "Coverage": {
            "included": [
                "Strictly scoped active campaign delivery and spend",
                "Campaign, ad set, and placement performance with results and funnel actions",
                "Meta creative preview cards for active ads",
                "Daily paid social performance trend for the selected range",
            ],
            "remaining": [
                "Explicit property-owned campaign mappings for every property",
                "Audience targeting detail beyond ad set naming",
                "Creative-level engagement diagnostics for every format",
            ],
        },
    }

def aggregate_google_ads_daily_rows(rows):
    aggregated = {}
    for row in rows:
        metrics = google_ads_attr(row, "metrics")
        date_value = google_ads_attr(row, "segments.date")
        if not date_value:
            continue
        bucket = aggregated.setdefault(date_value, {
            "date": date_value,
            "impressions": 0,
            "clicks": 0,
            "conversions": 0.0,
            "cost": 0.0,
        })
        bucket["impressions"] += int(google_ads_attr(metrics, "impressions", 0) or 0)
        bucket["clicks"] += int(google_ads_attr(metrics, "clicks", 0) or 0)
        bucket["conversions"] += float(google_ads_attr(metrics, "conversions", 0) or 0)
        bucket["cost"] += micros_to_currency(google_ads_attr(metrics, "cost_micros", 0) or 0)

    items = []
    for date_value in sorted(aggregated.keys()):
        bucket = aggregated[date_value]
        items.append({
            "date": bucket["date"],
            "impressions": bucket["impressions"],
            "clicks": bucket["clicks"],
            "conversions": round(bucket["conversions"], 2),
            "cost": round(bucket["cost"], 2),
        })
    return items

def build_google_ads_conversion_source(action_row):
    origin = google_ads_enum_name(google_ads_attr(action_row, "conversion_action.origin"))
    source_map = {
        "GOOGLE_ANALYTICS_4": "Website (Google Analytics 4)",
        "WEBSITE": "Website",
        "UPLOAD": "Imported",
        "GOOGLE_HOSTED": "Google hosted",
        "APP": "App",
        "CALL_FROM_ADS": "Call from Ads",
        "STORE": "Store",
    }
    return source_map.get(origin, origin or "Unknown")

def run_google_ads_query(client, customer_id, query, limit=None):
    service = client.get_service("GoogleAdsService")
    cleaned_customer_id = strip_non_digits(customer_id)
    rows = []
    response = service.search(customer_id=cleaned_customer_id, query=query)
    for index, row in enumerate(response):
        rows.append(row)
        if limit and index + 1 >= limit:
            break
    return rows

def summarize_google_ads_totals(rows):
    totals = {
        "impressions": 0,
        "clicks": 0,
        "cost": 0.0,
        "conversions": 0.0,
        "ctr": None,
        "avgCpc": None,
        "searchImpressionShare": None,
        "conversionRate": None,
    }
    search_impression_share_values = []

    for row in rows:
        metrics = google_ads_attr(row, "metrics")
        impressions = int(google_ads_attr(metrics, "impressions", 0) or 0)
        clicks = int(google_ads_attr(metrics, "clicks", 0) or 0)
        conversions = float(google_ads_attr(metrics, "conversions", 0) or 0)
        cost = micros_to_currency(google_ads_attr(metrics, "cost_micros", 0) or 0)
        totals["impressions"] += impressions
        totals["clicks"] += clicks
        totals["conversions"] += conversions
        totals["cost"] += cost

        search_impression_share = google_ads_attr(metrics, "search_impression_share")
        if search_impression_share not in (None, ""):
            try:
                search_impression_share_values.append(float(search_impression_share))
            except (TypeError, ValueError):
                pass

    if totals["impressions"] > 0:
        totals["ctr"] = round(totals["clicks"] / totals["impressions"], 4)
    if totals["clicks"] > 0:
        totals["avgCpc"] = round(totals["cost"] / totals["clicks"], 2)
    if totals["clicks"] > 0:
        totals["conversionRate"] = round(totals["conversions"] / totals["clicks"], 4)
    if search_impression_share_values:
        totals["searchImpressionShare"] = round(sum(search_impression_share_values) / len(search_impression_share_values), 4)

    totals["cost"] = round(totals["cost"], 2)
    totals["conversions"] = round(totals["conversions"], 2)
    return totals

def build_google_ads_campaign_rows(current_rows, previous_rows):
    previous_map = {
        google_ads_attr(row, "campaign.name", "(not set)"): row
        for row in previous_rows
    }
    items = []
    for row in current_rows:
        campaign_name = google_ads_attr(row, "campaign.name", "(not set)")
        current_metrics = summarize_google_ads_totals([row])
        previous_metrics = summarize_google_ads_totals([previous_map[campaign_name]]) if campaign_name in previous_map else summarize_google_ads_totals([])
        items.append({
            "campaignName": campaign_name,
            "current": current_metrics,
            "previous": previous_metrics,
            "delta": {
                "clicks": compute_change(current_metrics.get("clicks", 0), previous_metrics.get("clicks", 0)),
                "conversions": compute_change(current_metrics.get("conversions", 0), previous_metrics.get("conversions", 0)),
                "cost": compute_change(current_metrics.get("cost", 0), previous_metrics.get("cost", 0)),
            },
        })
    return items

def fetch_google_ads_dashboard_payload(
    property_id,
    google_ads_customer_id,
    property_name=None,
    start_date_value=None,
    end_date_value=None,
    default_days=90,
):
    if not google_ads_customer_id:
        raise ValueError("Missing required parameter: google_ads_customer_id")

    client = build_google_ads_client()
    window = resolve_reporting_window(start_date_value, end_date_value, default_days=default_days)
    current_start = window["current_start"].isoformat()
    current_end = window["current_end"].isoformat()
    previous_start = window["previous_start"].isoformat()
    previous_end = window["previous_end"].isoformat()

    search_filter = """
        campaign.advertising_channel_type = SEARCH
        AND campaign.status != REMOVED
    """

    campaign_query_template = """
        SELECT
          campaign.name,
          metrics.impressions,
          metrics.clicks,
          metrics.ctr,
          metrics.cost_micros,
          metrics.conversions,
          metrics.average_cpc,
          metrics.search_impression_share
        FROM campaign
        WHERE
          {search_filter}
          AND segments.date BETWEEN '{start_date}' AND '{end_date}'
        ORDER BY metrics.clicks DESC
        LIMIT 12
    """
    keyword_query_template = """
        SELECT
          campaign.name,
          ad_group.name,
          ad_group_criterion.keyword.text,
          ad_group_criterion.keyword.match_type,
          metrics.impressions,
          metrics.clicks,
          metrics.ctr,
          metrics.cost_micros,
          metrics.conversions,
          metrics.search_impression_share
        FROM keyword_view
        WHERE
          {search_filter}
          AND ad_group_criterion.status != REMOVED
          AND segments.date BETWEEN '{start_date}' AND '{end_date}'
        ORDER BY metrics.clicks DESC
        LIMIT 20
    """
    ad_query_template = """
        SELECT
          campaign.name,
          ad_group.name,
          ad_group_ad.ad.id,
          ad_group_ad.ad.name,
          ad_group_ad.ad.final_urls,
          ad_group_ad.ad.responsive_search_ad.headlines,
          ad_group_ad.ad.responsive_search_ad.descriptions,
          metrics.impressions,
          metrics.clicks,
          metrics.ctr,
          metrics.cost_micros,
          metrics.conversions
        FROM ad_group_ad
        WHERE
          {search_filter}
          AND ad_group_ad.status != REMOVED
          AND ad_group_ad.ad.type = RESPONSIVE_SEARCH_AD
          AND segments.date BETWEEN '{start_date}' AND '{end_date}'
        ORDER BY metrics.impressions DESC
        LIMIT 8
    """
    conversion_action_metadata_query = """
        SELECT
          conversion_action.resource_name,
          conversion_action.id,
          conversion_action.name,
          conversion_action.status,
          conversion_action.type,
          conversion_action.category,
          conversion_action.origin,
          conversion_action.primary_for_goal,
          conversion_action.counting_type,
          conversion_action.include_in_conversions_metric,
          conversion_action.click_through_lookback_window_days
        FROM conversion_action
        WHERE conversion_action.status != REMOVED
    """
    conversion_action_metrics_query = f"""
        SELECT
          segments.conversion_action,
          segments.conversion_action_name,
          metrics.all_conversions,
          metrics.all_conversions_value
        FROM customer
        WHERE segments.date BETWEEN '{current_start}' AND '{current_end}'
        ORDER BY metrics.all_conversions DESC
    """
    daily_query = f"""
        SELECT
          segments.date,
          metrics.impressions,
          metrics.clicks,
          metrics.conversions,
          metrics.cost_micros
        FROM campaign
        WHERE
          {search_filter}
          AND segments.date BETWEEN '{current_start}' AND '{current_end}'
        ORDER BY segments.date
    """

    campaign_current = run_google_ads_query(
        client,
        google_ads_customer_id,
        campaign_query_template.format(search_filter=search_filter, start_date=current_start, end_date=current_end),
    )
    campaign_previous = run_google_ads_query(
        client,
        google_ads_customer_id,
        campaign_query_template.format(search_filter=search_filter, start_date=previous_start, end_date=previous_end),
    )
    keyword_current = run_google_ads_query(
        client,
        google_ads_customer_id,
        keyword_query_template.format(search_filter=search_filter, start_date=current_start, end_date=current_end),
    )
    ad_current = run_google_ads_query(
        client,
        google_ads_customer_id,
        ad_query_template.format(search_filter=search_filter, start_date=current_start, end_date=current_end),
    )
    conversion_action_metadata = run_google_ads_query(
        client,
        google_ads_customer_id,
        conversion_action_metadata_query,
    )
    conversion_action_metrics = run_google_ads_query(
        client,
        google_ads_customer_id,
        conversion_action_metrics_query,
    )
    daily_current = run_google_ads_query(
        client,
        google_ads_customer_id,
        daily_query,
    )

    overview_current = summarize_google_ads_totals(campaign_current)
    overview_previous = summarize_google_ads_totals(campaign_previous)
    brand_terms = build_google_ads_brand_terms(property_name)
    brand_vs_non_brand = {
        "brand": {
            "impressions": 0,
            "clicks": 0,
            "cost": 0.0,
            "conversions": 0.0,
            "searchImpressionShareValues": [],
        },
        "nonBrand": {
            "impressions": 0,
            "clicks": 0,
            "cost": 0.0,
            "conversions": 0.0,
            "searchImpressionShareValues": [],
        },
    }

    keyword_rows = []
    for row in keyword_current:
        metrics = google_ads_attr(row, "metrics")
        keyword_text = google_ads_attr(row, "ad_group_criterion.keyword.text", "(not set)")
        clicks = int(google_ads_attr(metrics, "clicks", 0) or 0)
        impressions = int(google_ads_attr(metrics, "impressions", 0) or 0)
        cost = micros_to_currency(google_ads_attr(metrics, "cost_micros", 0) or 0)
        conversions = float(google_ads_attr(metrics, "conversions", 0) or 0)
        ctr = normalize_google_ads_ctr(google_ads_attr(metrics, "ctr"))
        search_impression_share = google_ads_attr(metrics, "search_impression_share")
        search_impression_share = round(float(search_impression_share), 4) if search_impression_share not in (None, "") else None
        match_type = google_ads_enum_name(google_ads_attr(row, "ad_group_criterion.keyword.match_type"))
        keyword_rows.append({
            "keywordText": keyword_text,
            "matchType": match_type,
            "campaignName": google_ads_attr(row, "campaign.name", "(not set)"),
            "adGroupName": google_ads_attr(row, "ad_group.name", "(not set)"),
            "impressions": impressions,
            "clicks": clicks,
            "ctr": ctr,
            "avgCpc": round(cost / clicks, 2) if clicks > 0 else None,
            "conversions": round(conversions, 2),
            "cost": round(cost, 2),
            "searchImpressionShare": search_impression_share,
        })

        classification = classify_google_ads_branding(keyword_text, brand_terms)
        bucket = brand_vs_non_brand[classification]
        bucket["impressions"] += impressions
        bucket["clicks"] += clicks
        bucket["cost"] += cost
        bucket["conversions"] += conversions
        if search_impression_share is not None:
            bucket["searchImpressionShareValues"].append(search_impression_share)

    for bucket in brand_vs_non_brand.values():
        bucket["ctr"] = round(bucket["clicks"] / bucket["impressions"], 4) if bucket["impressions"] > 0 else None
        bucket["avgCpc"] = round(bucket["cost"] / bucket["clicks"], 2) if bucket["clicks"] > 0 else None
        bucket["conversionRate"] = round(bucket["conversions"] / bucket["clicks"], 4) if bucket["clicks"] > 0 else None
        bucket["searchImpressionShare"] = (
            round(sum(bucket["searchImpressionShareValues"]) / len(bucket["searchImpressionShareValues"]), 4)
            if bucket["searchImpressionShareValues"] else None
        )
        bucket["cost"] = round(bucket["cost"], 2)
        bucket["conversions"] = round(bucket["conversions"], 2)
        bucket.pop("searchImpressionShareValues", None)

    conversion_action_metadata_map = {
        google_ads_attr(row, "conversion_action.resource_name"): row
        for row in conversion_action_metadata
    }
    conversion_action_rows = []
    for row in conversion_action_metrics:
        resource_name = google_ads_attr(row, "segments.conversion_action")
        metadata_row = conversion_action_metadata_map.get(resource_name)
        if not metadata_row:
            continue
        all_conversions = float(google_ads_attr(row, "metrics.all_conversions", 0) or 0)
        all_conversions_value = float(google_ads_attr(row, "metrics.all_conversions_value", 0) or 0)
        conversion_action_rows.append({
            "resourceName": resource_name,
            "conversionActionId": str(google_ads_attr(metadata_row, "conversion_action.id", "")),
            "name": google_ads_attr(metadata_row, "conversion_action.name", google_ads_attr(row, "segments.conversion_action_name", "(not set)")),
            "category": google_ads_enum_name(google_ads_attr(metadata_row, "conversion_action.category")),
            "type": google_ads_enum_name(google_ads_attr(metadata_row, "conversion_action.type")),
            "status": google_ads_enum_name(google_ads_attr(metadata_row, "conversion_action.status")),
            "source": build_google_ads_conversion_source(metadata_row),
            "primaryForGoal": bool(google_ads_attr(metadata_row, "conversion_action.primary_for_goal", False)),
            "countingType": google_ads_enum_name(google_ads_attr(metadata_row, "conversion_action.counting_type")),
            "includeInConversionsMetric": bool(google_ads_attr(metadata_row, "conversion_action.include_in_conversions_metric", False)),
            "clickThroughLookbackWindowDays": google_ads_attr(metadata_row, "conversion_action.click_through_lookback_window_days"),
            "allConversions": round(all_conversions, 2),
            "allConversionsValue": round(all_conversions_value, 2),
            "repeatRate": None,
            "repeatRateAvailable": False,
        })

    ad_rows = []
    for row in ad_current:
        metrics = google_ads_attr(row, "metrics")
        final_url = first_final_url(row)
        headlines = extract_ad_text_assets(google_ads_attr(row, "ad_group_ad.ad.responsive_search_ad.headlines", []))
        descriptions = extract_ad_text_assets(google_ads_attr(row, "ad_group_ad.ad.responsive_search_ad.descriptions", []))
        impressions = int(google_ads_attr(metrics, "impressions", 0) or 0)
        clicks = int(google_ads_attr(metrics, "clicks", 0) or 0)
        cost = micros_to_currency(google_ads_attr(metrics, "cost_micros", 0) or 0)
        conversions = float(google_ads_attr(metrics, "conversions", 0) or 0)
        ad_rows.append({
            "adId": str(google_ads_attr(row, "ad_group_ad.ad.id", "")),
            "adName": google_ads_attr(row, "ad_group_ad.ad.name"),
            "campaignName": google_ads_attr(row, "campaign.name", "(not set)"),
            "adGroupName": google_ads_attr(row, "ad_group.name", "(not set)"),
            "headlines": headlines,
            "descriptions": descriptions,
            "finalUrl": final_url,
            "path1": None,
            "path2": None,
            "displayUrl": build_display_url(final_url),
            "impressions": impressions,
            "clicks": clicks,
            "ctr": normalize_google_ads_ctr(google_ads_attr(metrics, "ctr")),
            "avgCpc": round(cost / clicks, 2) if clicks > 0 else None,
            "conversions": round(conversions, 2),
            "cost": round(cost, 2),
        })

    daily_rows = aggregate_google_ads_daily_rows(daily_current)

    return {
        "propertyId": str(property_id),
        "googleAdsCustomerId": strip_non_digits(google_ads_customer_id),
        "window": {
            "days": window["days"],
            "current": {
                "startDate": current_start,
                "endDate": current_end,
            },
            "previous": {
                "startDate": previous_start,
                "endDate": previous_end,
            },
        },
        "Overview": {
            "current": overview_current,
            "previous": overview_previous,
            "delta": {
                "clicks": compute_change(overview_current.get("clicks", 0), overview_previous.get("clicks", 0)),
                "conversions": compute_change(overview_current.get("conversions", 0), overview_previous.get("conversions", 0)),
                "cost": compute_change(overview_current.get("cost", 0), overview_previous.get("cost", 0)),
            },
        },
        "Campaigns": build_google_ads_campaign_rows(campaign_current, campaign_previous),
        "Keywords": keyword_rows,
        "ConversionActions": {
            "items": conversion_action_rows,
            "repeatRateNote": "Google Ads API does not currently expose the UI repeat-rate column directly, so this dashboard shows conversion totals and action metadata but leaves repeat rate blank.",
        },
        "BrandVsNonBrand": {
            **brand_vs_non_brand,
            "brandTerms": brand_terms,
        },
        "Ads": {
            "topAds": ad_rows,
            "dailyPerformance": daily_rows,
        },
        "Coverage": {
            "included": [
                "Search campaign performance",
                "Keyword performance with CPC and impression share",
                "Branded vs non-branded keyword split",
                "Responsive search ad desktop preview",
            ],
            "remaining": [
                "Search terms report",
                "Auction insights",
                "Asset-level sitelinks and callouts",
            ],
        },
    }

def build_comparison_rows(current_rows, previous_rows, key_name, output_key, metric_names):
    current_map = {
        row.get("dimensions", {}).get(key_name, "(not set)"): row.get("metrics", {})
        for row in current_rows
    }
    previous_map = {
        row.get("dimensions", {}).get(key_name, "(not set)"): row.get("metrics", {})
        for row in previous_rows
    }

    ordered_keys = []
    seen = set()
    for row in current_rows + previous_rows:
        key = row.get("dimensions", {}).get(key_name, "(not set)")
        if key not in seen:
            seen.add(key)
            ordered_keys.append(key)

    items = []
    for key in ordered_keys:
        current_metrics = current_map.get(key, {})
        previous_metrics = previous_map.get(key, {})
        delta = {
            metric_name: compute_change(
                current_metrics.get(metric_name, 0),
                previous_metrics.get(metric_name, 0),
            )
            for metric_name in metric_names
        }
        items.append({
            output_key: key,
            "current": {metric_name: current_metrics.get(metric_name, 0) for metric_name in metric_names},
            "previous": {metric_name: previous_metrics.get(metric_name, 0) for metric_name in metric_names},
            "delta": delta,
        })
    return items

def resolve_reporting_window(start_date_value=None, end_date_value=None, default_days=90):
    if start_date_value and end_date_value:
        start_date = parse_iso_date(start_date_value)
        end_date = parse_iso_date(end_date_value)
        if not start_date or not end_date or end_date < start_date:
            raise ValueError("Invalid start_date/end_date")
    else:
        end_date = get_local_now().date()
        days = max(int(default_days or 90), 1)
        start_date = end_date - datetime.timedelta(days=days - 1)

    comparison_days = (end_date - start_date).days + 1
    previous_end = start_date - datetime.timedelta(days=1)
    previous_start = previous_end - datetime.timedelta(days=comparison_days - 1)
    return {
        "current_start": start_date,
        "current_end": end_date,
        "previous_start": previous_start,
        "previous_end": previous_end,
        "days": comparison_days,
    }

def parse_numeric_candidate(value):
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    text = text.replace(",", "")
    if text.endswith("%"):
        try:
            return float(text[:-1]) / 100
        except ValueError:
            return None
    try:
        return float(text)
    except ValueError:
        return None

def normalize_matching_text(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())

def walk_nested_values(value, trail="root"):
    if isinstance(value, dict):
        yield trail, value
        for key, child in value.items():
            yield from walk_nested_values(child, f"{trail}.{key}")
    elif isinstance(value, list):
        yield trail, value
        for index, child in enumerate(value):
            yield from walk_nested_values(child, f"{trail}[{index}]")
    else:
        yield trail, value

def first_numeric_match(payload, aliases):
    alias_set = {alias.lower() for alias in aliases}
    for _, candidate in walk_nested_values(payload):
        if not isinstance(candidate, dict):
            continue
        for key, value in candidate.items():
            if str(key).lower() in alias_set:
                parsed = parse_numeric_candidate(value)
                if parsed is not None:
                    return parsed
    return None

def first_string_match(payload, aliases):
    alias_set = {alias.lower() for alias in aliases}
    for _, candidate in walk_nested_values(payload):
        if not isinstance(candidate, dict):
            continue
        for key, value in candidate.items():
            if str(key).lower() not in alias_set or value in (None, ""):
                continue
            if isinstance(value, (dict, list)):
                continue
            text = str(value).strip()
            if text:
                return text
    return None

def find_candidate_review_rows(payload, limit=8):
    best_rows = []
    best_score = -1
    review_aliases = {
        "review",
        "reviews",
        "comment",
        "comments",
        "message",
        "feedback",
        "response",
        "reply",
        "rating",
        "score",
        "author",
        "reviewer",
        "name",
        "source",
        "platform",
        "site",
        "date",
        "createdat",
        "publishedat",
    }
    for _, candidate in walk_nested_values(payload):
        if not isinstance(candidate, list) or not candidate:
            continue
        dict_rows = [item for item in candidate if isinstance(item, dict)]
        if not dict_rows:
            continue
        score = 0
        for row in dict_rows[: min(len(dict_rows), 6)]:
            row_keys = {str(key).replace("_", "").lower() for key in row.keys()}
            score += len(row_keys & review_aliases)
        if score > best_score:
            best_score = score
            best_rows = dict_rows[:limit]
    return best_rows

def normalize_reputation_rows(payload, limit=8):
    rows = []
    for row in find_candidate_review_rows(payload, limit=limit):
        author = (
            row.get("author")
            or row.get("reviewer")
            or row.get("name")
            or row.get("customerName")
            or row.get("residentName")
            or "Anonymous"
        )
        message = (
            row.get("review")
            or row.get("comment")
            or row.get("message")
            or row.get("feedback")
            or row.get("text")
            or row.get("body")
            or ""
        )
        reply = (
            row.get("response")
            or row.get("reply")
            or row.get("ownerResponse")
            or row.get("managementResponse")
            or ""
        )
        rows.append({
            "author": str(author).strip() or "Anonymous",
            "rating": parse_numeric_candidate(
                row.get("rating")
                or row.get("score")
                or row.get("stars")
                or row.get("value")
            ),
            "source": (
                row.get("source")
                or row.get("platform")
                or row.get("site")
                or row.get("channel")
                or "Review"
            ),
            "publishedAt": (
                row.get("publishedAt")
                or row.get("createdAt")
                or row.get("date")
                or row.get("reviewDate")
                or row.get("created_at")
            ),
            "message": str(message).strip(),
            "response": str(reply).strip(),
            "status": row.get("status") or row.get("state") or row.get("sentiment"),
        })
    return rows

def normalize_reputation_payload(payload, property_id, location_id, location_name, window):
    average_rating = first_numeric_match(payload, [
        "averageRating",
        "avgRating",
        "rating",
        "publicRating",
        "publicScore",
        "score",
    ])
    review_count = first_numeric_match(payload, [
        "reviewCount",
        "reviewsCount",
        "totalReviews",
        "publicReviewCount",
        "reviews",
        "count",
    ])
    response_rate = first_numeric_match(payload, [
        "responseRate",
        "replyRate",
        "ownerResponseRate",
        "managementResponseRate",
    ])
    sentiment_score = first_numeric_match(payload, [
        "sentimentScore",
        "positiveShare",
        "positiveRate",
        "satisfactionScore",
    ])

    recent_reviews = normalize_reputation_rows(payload)
    summary_lines = []
    status_text = first_string_match(payload, ["status", "state", "result", "message"])
    if status_text:
        summary_lines.append(status_text)
    if not recent_reviews:
        summary_lines.append("No review rows were recognized in the Opiniion payload yet.")

    return {
        "propertyId": str(property_id),
        "locationId": str(location_id),
        "locationName": location_name,
        "window": {
            "startDate": window["current_start"].isoformat(),
            "endDate": window["current_end"].isoformat(),
            "days": window["days"],
        },
        "overview": {
            "averageRating": average_rating,
            "reviewCount": int(review_count) if review_count is not None else None,
            "responseRate": response_rate,
            "sentimentScore": sentiment_score,
        },
        "recentReviews": recent_reviews,
        "summary": summary_lines,
        "rawTopLevelKeys": sorted(payload.keys()) if isinstance(payload, dict) else [],
        "rawPayload": payload,
    }

def post_opiniion_json(payload, path):
    response = requests.post(
        f"{OPINIION_API_BASE_URL.rstrip('/')}/{path.lstrip('/')}",
        json=payload,
        headers={"Content-Type": "application/json"},
        timeout=60,
    )
    response.raise_for_status()
    try:
        return response.json()
    except ValueError:
        raise ValueError(f"Opiniion endpoint {path} did not return JSON.")

def fetch_opiniion_user_locations(email, password):
    payload = post_opiniion_json({
        "email": email,
        "password": password,
    }, "data/userLocations")
    if not isinstance(payload, list):
        raise ValueError("Opiniion userLocations returned an unexpected payload.")

    locations = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        location_id = item.get("locationId")
        api_key = item.get("apiKey")
        if location_id in (None, "") or api_key in (None, ""):
            continue
        locations.append({
            "locationId": str(location_id),
            "name": item.get("name") or f"Location {location_id}",
            "apiKey": str(api_key),
        })
    return locations

def fetch_opiniion_location_details(location_id, api_key):
    payload = post_opiniion_json({
        "locationId": location_id,
        "apiKey": api_key,
    }, "data/location")
    if not payload.get("success"):
        return {}
    return payload.get("location") or {}

def fetch_opiniion_reviews(location_id, api_key, start_ms=None, end_ms=None):
    request_payload = {
        "locationId": location_id,
        "apiKey": api_key,
    }
    if start_ms is not None:
        request_payload["startDate"] = int(start_ms)
    if end_ms is not None:
        request_payload["endDate"] = int(end_ms)
    payload = post_opiniion_json(request_payload, "data/reviews")
    if not payload.get("success"):
        return []
    reviews = payload.get("reviews") or []
    return reviews if isinstance(reviews, list) else []

def resolve_opiniion_location(property_id, property_data, available_locations, explicit_location_id=None, explicit_location_name=None, property_name=None, property_city=None):
    if explicit_location_id:
        explicit = str(explicit_location_id)
        for location in available_locations:
            if location["locationId"] == explicit:
                return location
        raise ValueError(f"Configured Opiniion location {explicit} was not returned for this user.")

    configured_location_id = (
        property_data.get(OPINIION_LOCATION_FIELD)
        or property_data.get("opiniionLocationId")
        or property_data.get("reputationLocationId")
    )
    if configured_location_id:
        configured = str(configured_location_id)
        for location in available_locations:
            if location["locationId"] == configured:
                return location

    configured_location_name = (
        explicit_location_name
        or property_data.get("opiniionLocationName")
        or property_data.get("reputationLocationName")
    )
    if configured_location_name:
        target = normalize_matching_text(configured_location_name)
        exact_name_matches = [
            location for location in available_locations
            if normalize_matching_text(location.get("name")) == target
        ]
        if len(exact_name_matches) == 1:
            return exact_name_matches[0]
        if len(exact_name_matches) > 1:
            raise ValueError(
                f"Multiple Opiniion locations matched configured name '{configured_location_name}' for property {property_id}."
            )

    property_name = property_name or property_data.get("name") or property_data.get("propertyName") or ""
    property_city = property_city or property_data.get("city") or ""
    target_name = normalize_matching_text(property_name)
    target_city = normalize_matching_text(property_city)

    exact_matches = [
        location for location in available_locations
        if normalize_matching_text(location.get("name")) == target_name and target_name
    ]
    if len(exact_matches) == 1:
        return exact_matches[0]

    city_matches = []
    for location in available_locations:
        location_name = normalize_matching_text(location.get("name"))
        if target_name and (target_name in location_name or location_name in target_name):
            if not target_city or target_city in location_name:
                city_matches.append(location)
    if len(city_matches) == 1:
        return city_matches[0]
    if city_matches:
        return city_matches[0]

    raise ValueError(
        f"No Opiniion location could be matched for property {property_id}. "
        f"Add {OPINIION_LOCATION_FIELD} to the property document to map it explicitly."
    )

def map_opiniion_reviews(reviews, location_id):
    rows = []
    for review in reviews[:8]:
        if not isinstance(review, dict):
            continue
        review_date = review.get("date")
        published_at = None
        try:
            if review_date not in (None, ""):
                published_at = datetime.datetime.fromtimestamp(float(review_date) / 1000, tz=APP_TIMEZONE).isoformat()
        except Exception:
            published_at = None

        rows.append({
            "author": str(review.get("name") or "").strip() or "Anonymous",
            "rating": parse_numeric_candidate(review.get("rating")),
            "source": review.get("source") or "Opiniion",
            "publishedAt": published_at or review.get("readableDate"),
            "message": str(review.get("reviewText") or "").strip(),
            "response": str(review.get("responseText") or review.get("replyText") or "").strip(),
            "status": review.get("status") or review.get("event"),
            "reviewId": str(review.get("reviewId") or review.get("id") or ""),
            "locationId": str(review.get("locationId") or location_id),
        })
    return rows

def fetch_opiniion_reputation_payload(property_id, location_id=None, location_name=None, property_name=None, property_city=None, start_date_value=None, end_date_value=None, default_days=90):
    email = os.environ.get("OPINIION_USER_EMAIL")
    password = os.environ.get("OPINIION_USER_PASSWORD")
    if not email or not password:
        raise ValueError("OPINIION_USER_EMAIL and OPINIION_USER_PASSWORD secrets must be configured.")

    init_firebase()
    property_snapshot = firestore.client().collection("properties").document(str(property_id)).get()
    property_data = property_snapshot.to_dict() if property_snapshot.exists else {}
    window = resolve_reporting_window(start_date_value, end_date_value, default_days=default_days)
    locations = fetch_opiniion_user_locations(email, password)
    if not locations:
        raise ValueError("No Opiniion locations were returned for the configured user.")

    resolved_location = resolve_opiniion_location(
        property_id,
        property_data,
        locations,
        explicit_location_id=location_id,
        explicit_location_name=location_name,
        property_name=property_name,
        property_city=property_city,
    )
    location_details = fetch_opiniion_location_details(
        resolved_location["locationId"],
        resolved_location["apiKey"],
    )

    start_dt = datetime.datetime.combine(window["current_start"], datetime.time.min, tzinfo=APP_TIMEZONE)
    end_dt = datetime.datetime.combine(window["current_end"], datetime.time.max, tzinfo=APP_TIMEZONE)
    reviews = fetch_opiniion_reviews(
        resolved_location["locationId"],
        resolved_location["apiKey"],
        start_ms=int(start_dt.timestamp() * 1000),
        end_ms=int(end_dt.timestamp() * 1000),
    )
    response_payload = {
        "location": location_details,
        "reviews": reviews,
    }
    normalized = normalize_reputation_payload(
        response_payload,
        property_id,
        resolved_location["locationId"],
        resolved_location.get("name"),
        window,
    )
    normalized["overview"]["averageRating"] = parse_numeric_candidate(location_details.get("currentGoogleRating"))
    normalized["overview"]["reviewCount"] = len(reviews)
    normalized["recentReviews"] = map_opiniion_reviews(reviews, resolved_location["locationId"])
    normalized["summary"] = [
        f"Matched Opiniion location: {resolved_location.get('name')} ({resolved_location['locationId']})",
        f"Fetched {len(reviews)} reviews in the selected window.",
    ]
    normalized["rawTopLevelKeys"] = ["location", "reviews"]
    return normalized

def fetch_ga4_dashboard_payload(property_id, ga4_property_id, start_date_value=None, end_date_value=None, default_days=90):
    client, funnel_client = build_ga4_clients()
    window = resolve_reporting_window(start_date_value, end_date_value, default_days=default_days)
    current_start = window["current_start"]
    current_end = window["current_end"]
    previous_start = window["previous_start"]
    previous_end = window["previous_end"]

    channel_metrics = ["sessions", "newUsers", "averageSessionDuration", "engagementRate"]
    overview_metrics = [
        "sessions",
        "newUsers",
        "screenPageViews",
        "screenPageViewsPerSession",
        "engagedSessions",
        "engagementRate",
        "averageSessionDuration",
        "keyEvents",
    ]
    channel_current = run_ga4_report(
        client,
        ga4_property_id,
        current_start,
        current_end,
        ["sessionDefaultChannelGroup"],
        channel_metrics,
        limit=20,
        order_bys=[build_metric_order_by("sessions")],
    )
    channel_previous = run_ga4_report(
        client,
        ga4_property_id,
        previous_start,
        previous_end,
        ["sessionDefaultChannelGroup"],
        channel_metrics,
        limit=20,
        order_bys=[build_metric_order_by("sessions")],
    )
    overview_current = run_ga4_report(
        client,
        ga4_property_id,
        current_start,
        current_end,
        [],
        overview_metrics,
        limit=1,
    )
    overview_previous = run_ga4_report(
        client,
        ga4_property_id,
        previous_start,
        previous_end,
        [],
        overview_metrics,
        limit=1,
    )

    source_medium_metrics = [
        "sessions",
        "screenPageViews",
        "engagementRate",
        "keyEvents",
        "averageSessionDuration",
        "screenPageViewsPerSession",
        "engagedSessions",
    ]
    source_medium_current = run_ga4_report(
        client,
        ga4_property_id,
        current_start,
        current_end,
        ["sessionSource", "sessionMedium"],
        source_medium_metrics,
        limit=10,
        order_bys=[build_metric_order_by("sessions")],
    )
    source_medium_previous = run_ga4_report(
        client,
        ga4_property_id,
        previous_start,
        previous_end,
        ["sessionSource", "sessionMedium"],
        source_medium_metrics,
        limit=10,
        order_bys=[build_metric_order_by("sessions")],
    )

    traffic_by_month_current = run_ga4_report(
        client,
        ga4_property_id,
        current_start,
        current_end,
        ["month"],
        ["sessions", "newUsers"],
        limit=12,
        order_bys=[build_dimension_order_by("month")],
    )

    llm_filter = combine_or_filters([
        build_string_contains_filter("sessionSource", source)
        for source in LLM_SOURCES
    ])
    llm_traffic_current = run_ga4_report(
        client,
        ga4_property_id,
        current_start,
        current_end,
        ["sessionSource"],
        ["sessions", "screenPageViews", "engagementRate", "keyEvents"],
        limit=12,
        dimension_filter=llm_filter,
        order_bys=[build_metric_order_by("sessions")],
    )

    conversion_current = run_ga4_report(
        client,
        ga4_property_id,
        current_start,
        current_end,
        ["eventName"],
        ["eventCount"],
        limit=len(GA4_CONVERSION_EVENTS),
        dimension_filter=build_event_name_filter(GA4_CONVERSION_EVENTS),
        order_bys=[build_dimension_order_by("eventName")],
    )
    conversion_previous = run_ga4_report(
        client,
        ga4_property_id,
        previous_start,
        previous_end,
        ["eventName"],
        ["eventCount"],
        limit=len(GA4_CONVERSION_EVENTS),
        dimension_filter=build_event_name_filter(GA4_CONVERSION_EVENTS),
        order_bys=[build_dimension_order_by("eventName")],
    )
    first_user_medium_current = run_ga4_report(
        client,
        ga4_property_id,
        current_start,
        current_end,
        ["firstUserMedium"],
        ["keyEvents", "totalUsers"],
        limit=12,
        order_bys=[build_metric_order_by("keyEvents")],
    )
    conversions_by_day_current = run_ga4_report(
        client,
        ga4_property_id,
        current_start,
        current_end,
        ["date"],
        ["keyEvents", "sessions"],
        limit=120,
        order_bys=[build_dimension_order_by("date")],
    )
    organic_conversion_breakdown_current = run_ga4_report(
        client,
        ga4_property_id,
        current_start,
        current_end,
        ["eventName"],
        ["eventCount"],
        limit=15,
        order_bys=[build_metric_order_by("eventCount")],
    )

    landing_current = run_ga4_report(
        client,
        ga4_property_id,
        current_start,
        current_end,
        ["landingPagePlusQueryString"],
        ["eventCount"],
        limit=10,
        dimension_filter=build_event_name_filter(GA4_CONVERSION_EVENTS),
        order_bys=[build_metric_order_by("eventCount")],
    )
    landing_previous = run_ga4_report(
        client,
        ga4_property_id,
        previous_start,
        previous_end,
        ["landingPagePlusQueryString"],
        ["eventCount"],
        limit=10,
        dimension_filter=build_event_name_filter(GA4_CONVERSION_EVENTS),
        order_bys=[build_metric_order_by("eventCount")],
    )

    device_current = run_ga4_report(
        client,
        ga4_property_id,
        current_start,
        current_end,
        ["deviceCategory"],
        ["eventCount"],
        limit=10,
        dimension_filter=build_event_name_filter(GA4_CONVERSION_EVENTS),
        order_bys=[build_metric_order_by("eventCount")],
    )
    device_previous = run_ga4_report(
        client,
        ga4_property_id,
        previous_start,
        previous_end,
        ["deviceCategory"],
        ["eventCount"],
        limit=10,
        dimension_filter=build_event_name_filter(GA4_CONVERSION_EVENTS),
        order_bys=[build_metric_order_by("eventCount")],
    )

    geo_current = run_ga4_report(
        client,
        ga4_property_id,
        current_start,
        current_end,
        ["city"],
        ["totalUsers", "keyEvents"],
        limit=10,
        order_bys=[build_metric_order_by("totalUsers")],
    )
    geo_previous = run_ga4_report(
        client,
        ga4_property_id,
        previous_start,
        previous_end,
        ["city"],
        ["totalUsers", "keyEvents"],
        limit=10,
        order_bys=[build_metric_order_by("totalUsers")],
    )
    device_detailed_current = run_ga4_report(
        client,
        ga4_property_id,
        current_start,
        current_end,
        ["deviceCategory"],
        ["engagedSessions", "engagementRate", "screenPageViews", "screenPageViewsPerSession", "keyEvents"],
        limit=10,
        order_bys=[build_metric_order_by("screenPageViews")],
    )
    page_performance_current = run_ga4_report(
        client,
        ga4_property_id,
        current_start,
        current_end,
        ["pageTitle"],
        ["sessions", "engagementRate", "userEngagementDuration", "keyEvents"],
        limit=10,
        order_bys=[build_metric_order_by("sessions")],
    )

    diagnostic_current = run_ga4_report(
        client,
        ga4_property_id,
        current_start,
        current_end,
        ["pagePath"],
        ["screenPageViews", "userEngagementDuration", "engagementRate"],
        limit=10,
        order_bys=[build_metric_order_by("screenPageViews")],
    )
    diagnostic_previous = run_ga4_report(
        client,
        ga4_property_id,
        previous_start,
        previous_end,
        ["pagePath"],
        ["screenPageViews", "userEngagementDuration", "engagementRate"],
        limit=10,
        order_bys=[build_metric_order_by("screenPageViews")],
    )

    apply_page_current = run_ga4_report(
        client,
        ga4_property_id,
        current_start,
        current_end,
        ["pagePath"],
        ["screenPageViews", "userEngagementDuration", "engagementRate"],
        limit=25,
        dimension_filter=build_path_contains_filter("pagePath", "/apply"),
        order_bys=[build_metric_order_by("screenPageViews")],
    )

    path_start_steps = run_ga4_funnel_next_actions(
        funnel_client,
        ga4_property_id,
        current_start,
        current_end,
        [AnalyticsFunnelStep(name="Session start", filter_expression=build_funnel_event_expression("session_start"))],
        limit=5,
    )
    path_start_total = sum(item["activeUsers"] for item in path_start_steps)
    path_branches = []
    for start_item in path_start_steps[:4]:
        next_steps = run_ga4_funnel_next_actions(
            funnel_client,
            ga4_property_id,
            current_start,
            current_end,
            [build_page_view_step("Landing page", start_item["label"])],
            limit=4,
        )
        path_branches.append({
            "entryPage": start_item["label"],
            "entryUsers": start_item["activeUsers"],
            "shareOfStarts": round(start_item["activeUsers"] / path_start_total, 4) if path_start_total > 0 else None,
            "shownContinuationRate": (
                round(sum(step["activeUsers"] for step in next_steps) / start_item["activeUsers"], 4)
                if start_item["activeUsers"] > 0 else None
            ),
            "nextSteps": [
                {
                    "pagePath": step["label"],
                    "activeUsers": step["activeUsers"],
                    "shareOfParent": round(step["activeUsers"] / start_item["activeUsers"], 4) if start_item["activeUsers"] > 0 else None,
                }
                for step in next_steps
            ],
        })

    application_submitted_current = next(
        (
            row for row in conversion_current
            if row.get("dimensions", {}).get("eventName") == "application_submitted"
        ),
        {"metrics": {"eventCount": 0}},
    )
    apply_page_views = sum_metric(apply_page_current, "screenPageViews")
    apply_submissions = float(application_submitted_current.get("metrics", {}).get("eventCount", 0) or 0)
    apply_abandonment_rate = None
    if apply_page_views > 0:
        apply_abandonment_rate = max(0.0, round(1 - (apply_submissions / apply_page_views), 4))

    overview_current_metrics = overview_current[0]["metrics"] if overview_current else {}
    overview_previous_metrics = overview_previous[0]["metrics"] if overview_previous else {}

    source_prev_map = {
        (
            row.get("dimensions", {}).get("sessionSource", "(not set)"),
            row.get("dimensions", {}).get("sessionMedium", "(not set)"),
        ): row.get("metrics", {})
        for row in source_medium_previous
    }
    top_sources = []
    for row in source_medium_current:
        dims = row.get("dimensions", {})
        metrics = row.get("metrics", {})
        key = (dims.get("sessionSource", "(not set)"), dims.get("sessionMedium", "(not set)"))
        prev = source_prev_map.get(key, {})
        sessions = float(metrics.get("sessions", 0) or 0)
        key_events = float(metrics.get("keyEvents", 0) or 0)
        top_sources.append({
            "sessionSource": key[0],
            "sessionMedium": key[1],
            "current": metrics,
            "previous": prev,
            "conversionRate": round(key_events / sessions, 4) if sessions > 0 else None,
            "delta": {
                "sessions": compute_change(metrics.get("sessions", 0), prev.get("sessions", 0)),
                "keyEvents": compute_change(metrics.get("keyEvents", 0), prev.get("keyEvents", 0)),
            },
        })

    conversion_by_medium = []
    for row in first_user_medium_current:
        metrics = row.get("metrics", {})
        total_users = float(metrics.get("totalUsers", 0) or 0)
        key_events = float(metrics.get("keyEvents", 0) or 0)
        conversion_by_medium.append({
            "firstUserMedium": row.get("dimensions", {}).get("firstUserMedium", "(not set)"),
            "keyEvents": key_events,
            "totalUsers": total_users,
            "conversionRate": round(key_events / total_users, 4) if total_users > 0 else None,
        })

    conversions_by_day = []
    for row in conversions_by_day_current:
        metrics = row.get("metrics", {})
        sessions = float(metrics.get("sessions", 0) or 0)
        key_events = float(metrics.get("keyEvents", 0) or 0)
        conversions_by_day.append({
            "date": row.get("dimensions", {}).get("date"),
            "keyEvents": key_events,
            "sessions": sessions,
            "conversionRate": round(key_events / sessions, 4) if sessions > 0 else None,
        })

    return {
        "propertyId": str(property_id),
        "ga4PropertyId": str(ga4_property_id),
        "window": {
            "days": window["days"],
            "current": {
                "startDate": current_start.isoformat(),
                "endDate": current_end.isoformat(),
            },
            "previous": {
                "startDate": previous_start.isoformat(),
                "endDate": previous_end.isoformat(),
            },
        },
        "Acquisition": {
            "channels": build_comparison_rows(
                channel_current,
                channel_previous,
                "sessionDefaultChannelGroup",
                "channel",
                channel_metrics,
            ),
            "topSources": top_sources,
            "trafficByMonth": [
                {
                    "month": row.get("dimensions", {}).get("month"),
                    **row.get("metrics", {}),
                }
                for row in traffic_by_month_current
            ],
            "trafficBySessionSource": [
                {
                    "sessionSource": row.get("dimensions", {}).get("sessionSource", "(not set)"),
                    "sessions": row.get("metrics", {}).get("sessions", 0),
                }
                for row in source_medium_current
                if row.get("dimensions", {}).get("sessionMedium") == "organic"
            ],
            "totals": {
                "current": overview_current_metrics,
                "previous": overview_previous_metrics,
            },
            "llmTraffic": llm_traffic_current,
        },
        "Conversion": {
            "events": build_comparison_rows(
                conversion_current,
                conversion_previous,
                "eventName",
                "eventName",
                ["eventCount"],
            ),
            "landingPages": build_comparison_rows(
                landing_current,
                landing_previous,
                "landingPagePlusQueryString",
                "landingPagePlusQueryString",
                ["eventCount"],
            ),
            "deviceBreakdown": build_comparison_rows(
                device_current,
                device_previous,
                "deviceCategory",
                "deviceCategory",
                ["eventCount"],
            ),
            "totals": {
                "currentEventCount": sum_metric(conversion_current, "eventCount"),
                "previousEventCount": sum_metric(conversion_previous, "eventCount"),
            },
            "conversionByMedium": conversion_by_medium,
            "conversionsByDay": conversions_by_day,
            "organicConversionBreakdown": [
                {
                    "eventName": row.get("dimensions", {}).get("eventName"),
                    "eventCount": row.get("metrics", {}).get("eventCount", 0),
                }
                for row in organic_conversion_breakdown_current
            ],
        },
        "Geo": {
            "cities": build_comparison_rows(
                geo_current,
                geo_previous,
                "city",
                "city",
                ["totalUsers", "keyEvents"],
            ),
        },
        "Diagnostic": {
            "topPages": build_comparison_rows(
                diagnostic_current,
                diagnostic_previous,
                "pagePath",
                "pagePath",
                ["screenPageViews", "userEngagementDuration", "engagementRate"],
            ),
            "applyPage": {
                "currentViews": apply_page_views,
                "currentEngagementDuration": sum_metric(apply_page_current, "userEngagementDuration"),
                "currentEngagementRate": (
                    round(sum_metric(apply_page_current, "engagementRate") / len(apply_page_current), 4)
                    if apply_page_current else None
                ),
                "applicationSubmittedEvents": apply_submissions,
                "abandonmentRate": apply_abandonment_rate,
                "note": "Abandonment rate is currently using application_submitted as the downstream conversion proxy until lease-start analytics are connected.",
            },
            "pathExploration": {
                "startingPoint": "session_start",
                "startingUsers": path_start_total,
                "startPages": [
                    {
                        "pagePath": item["label"],
                        "activeUsers": item["activeUsers"],
                        "shareOfStarts": round(item["activeUsers"] / path_start_total, 4) if path_start_total > 0 else None,
                    }
                    for item in path_start_steps
                ],
                "branches": path_branches,
                "note": "Path exploration uses GA4 funnel next-action reporting on pagePath. Shown continuation reflects the top returned next pages, not every long-tail branch.",
            },
            "devicesDetailed": [
                {
                    "deviceCategory": row.get("dimensions", {}).get("deviceCategory", "(not set)"),
                    **row.get("metrics", {}),
                }
                for row in device_detailed_current
            ],
            "pagePerformance": [
                {
                    "pageTitle": row.get("dimensions", {}).get("pageTitle", "(not set)"),
                    **row.get("metrics", {}),
                }
                for row in page_performance_current
            ],
        },
        "CoverageGaps": {
            "requiresSearchConsole": [
                "Organic search queries with impressions, clicks, CTR, and average position",
            ],
            "requiresGoogleAds": [
                "Paid campaign performance by day/week with impressions, clicks, conversions, and cost",
                "Keyword breakdown with avg CPC and impression share",
                "Branded vs non-branded paid search spend, clicks, conversions, and impression share",
                "Top-performing paid search ads and creative-level breakdowns",
            ],
            "requiresMetaAds": [
                "Reach, frequency, CPM, top ad previews, and paid social creative performance",
            ],
        },
    }

def fetch_paginated_leases_for_range(property_id, params, per_page=LEASE_ATTRIBUTION_PAGE_SIZE):
    page_no = 1
    all_items = []
    last_meta = {}

    while True:
        response_payload = make_entrata_request(
            "getLeases",
            "v1/leases",
            params,
            property_id,
            page_no=page_no,
            per_page=per_page,
            include_response_meta=True,
        )
        result = response_payload.get("result", {}) if isinstance(response_payload, dict) else {}
        items = extract_nested_items(result, "leases", "lease")
        last_meta = response_payload.get("meta", {}) if isinstance(response_payload, dict) else {}
        all_items.extend(items)

        total = last_meta.get("total")
        try:
            total = int(total) if total not in (None, "") else None
        except (TypeError, ValueError):
            total = None

        if total is not None and len(all_items) >= total:
            break
        if len(items) < per_page:
            break

        page_no += 1

    return all_items, last_meta

def fetch_leads_for_date(property_id, date_str):
    params = {
        "propertyId": property_id,
        "fromDate": date_str,
        "toDate": date_str,
        "includeDemographics": "0",
        "excludeAmenities": "0"
    }
    result = make_entrata_request("getLeads", "v1/leads", params, property_id)
    
    # Entrata returns prospects as a list containing a dict with a prospect list
    items = extract_nested_items(result, "prospects", "prospect")
    save_raw_data(property_id, "leads", items, date_str)

def fetch_events_for_date(property_id, date_str):
    params = {
        "propertyId": property_id,
        "eventTypeIds": LEAD_EVENT_TYPE_IDS,
        "eventDateFrom": date_str,
        "eventDateTo": date_str
    }
    result = make_entrata_request("getLeadEvents", "v1/leads", params, property_id)

    prospects_data = result.get("prospects", {})
    items = prospects_data.get("prospect", []) if isinstance(prospects_data, dict) else []
    if isinstance(items, dict):
        items = [items]

    flattened_events = []
    for prospect in items:
        application_id = prospect.get("applicationId")
        nested_events = prospect.get("events", {}).get("event", [])
        if isinstance(nested_events, dict):
            nested_events = [nested_events]

        for event in nested_events:
            flattened_events.append({
                **event,
                "applicationId": application_id
            })

    save_raw_data(property_id, "events", flattened_events, date_str)

def fetch_leases_for_date(property_id, date_str):
    params = {"propertyId": property_id, "moveInDateFrom": date_str, "moveInDateTo": date_str}
    result = make_entrata_request("getLeases", "v1/leases", params, property_id)
    
    # Entrata returns leases as a list containing a dict with a lease list
    items = extract_nested_items(result, "leases", "lease")
    save_raw_data(property_id, "leases", items, date_str)

def fetch_invoices_for_date(property_id, date_str):
    dt = datetime.datetime.strptime(date_str, "%m/%d/%Y")
    post_month = dt.strftime("%m/%Y")
    params = {
        "propertyIds": str(property_id),
        "glAccountFrom": MARKETING_GL_ACCOUNT_FROM,
        "glAccountTo": MARKETING_GL_ACCOUNT_TO,
        "postMonthFrom": post_month,
        "postMonthTo": post_month,
        "postDateFrom": date_str,
        "postDateTo": date_str,
        "isCashBook": "0",
        "isDetailed": "1",
        "excludeApTransactions": "0",
        "excludeArTransactions": "1",
        "excludeExportedTransactions": "0"
    }
    result = make_entrata_request("getGlTransactions", "v1/financial", params, property_id)

    properties = result.get("properties", {}).get("property", [])
    if isinstance(properties, dict):
        properties = [properties]

    flattened_items = []
    for property_entry in properties:
        property_attrs = property_entry.get("@attributes", {})
        transactions = property_entry.get("transactions", {}).get("transaction", [])
        if isinstance(transactions, dict):
            transactions = [transactions]

        for transaction in transactions:
            account_attrs = transaction.get("@attributes", {})
            gl_total = transaction.get("glTotal", {})
            gl_details = transaction.get("glDetails", {}).get("glDetail", [])
            if isinstance(gl_details, dict):
                gl_details = [gl_details]

            for detail in gl_details:
                flattened_items.append({
                    **detail,
                    "property": property_attrs,
                    "glAccount": account_attrs,
                    "glTotal": gl_total
                })

    save_raw_data(property_id, "invoices", flattened_items, date_str)

def fetch_availability_for_date(property_id, date_str):
    params = {
        "propertyId": property_id, "availableUnitsOnly": "1", "unavailableUnitsOnly": "0",
        "skipPricing": "0", "showChildProperties": "1", "includeDisabledFloorplans": "1",
        "includeDisabledUnits": "1", "showUnitSpaces": "1", "useSpaceConfiguration": "0",
        "allowLeaseExpirationOverride": "1", "moveInStartDate": date_str, "moveInEndDate": date_str
    }
    result = make_entrata_request(
        "getUnitsAvailabilityAndPricing",
        "v1/properties",
        params,
        property_id,
        include_pagination=False,
    )
    
    # Entrata returns ILS_Units as a list containing a dict with a Unit list
    items = extract_nested_items(result, "ILS_Units", "Unit")
    save_raw_data(property_id, "availability", items, date_str)

def fetch_specials(property_id):
    params = {
        "propertyId": property_id,
    }
    result = make_entrata_request(
        "getSpecials",
        "v1/propertyunits",
        params,
        property_id,
        include_pagination=False,
        method_version="r2",
    )
    items = extract_special_items(result)
    return store_property_specials(property_id, items, raw_result=result)

def fetch_units_availability_and_pricing(property_id, move_in_start_date=None, move_in_end_date=None):
    today = get_local_now().date()
    start_date = move_in_start_date or datetime.date(today.year, 1, 1)
    end_date = move_in_end_date or today
    params = {
        "propertyId": property_id,
        "availableUnitsOnly": "1",
        "unavailableUnitsOnly": "0",
        "skipPricing": "0",
        "showChildProperties": "1",
        "includeDisabledFloorplans": "0",
        "includeDisabledUnits": "0",
        "showUnitSpaces": "1",
        "useSpaceConfiguration": "0",
        "allowLeaseExpirationOverride": "1",
        "moveInStartDate": format_entrata_date(start_date),
        "moveInEndDate": format_entrata_date(end_date),
    }
    result = make_entrata_request(
        "getUnitsAvailabilityAndPricing",
        "v1/propertyunits",
        params,
        property_id,
        include_pagination=False,
        method_version="r1",
    )
    return store_property_availability_pricing(property_id, result)

def sync_property_date_for_roi(property_id, date_str):
    fetch_leads_for_date(property_id, date_str)
    fetch_events_for_date(property_id, date_str)
    fetch_leases_for_date(property_id, date_str)
    fetch_invoices_for_date(property_id, date_str)

def extract_lead_contact_fields(lead_data):
    first_name = recursively_find_first_value(lead_data, ["firstName", "firstname"])
    last_name = recursively_find_first_value(lead_data, ["lastName", "lastname"])
    full_name = first_non_empty(
        recursively_find_first_value(lead_data, ["nameFull", "fullName", "fullname", "displayName", "name"]),
        " ".join(part for part in [normalize_string(first_name), normalize_string(last_name)] if part),
    )
    email = recursively_find_first_value(
        lead_data,
        ["email", "emailAddress", "primaryEmail", "emailaddress", "prospectEmail", "guestCardEmail"],
    )
    phone = recursively_find_first_value(
        lead_data,
        ["phoneNumber", "primaryPhoneNumber", "mobilePhone", "phone", "phone_number"],
    )
    return {
        "normalized_email": normalize_email(email),
        "normalized_phone": normalize_phone(phone),
        "normalized_full_name": normalize_full_name(full_name),
    }

def build_lead_index(property_id, lookback_days=LEASE_ATTRIBUTION_LEAD_LOOKBACK_DAYS):
    db = firestore.client()
    end_dt = get_local_now().date()
    start_dt = end_dt - datetime.timedelta(days=max(lookback_days, 1))
    start_ts = datetime.datetime.combine(start_dt, datetime.time.min, tzinfo=datetime.timezone.utc)
    end_ts = datetime.datetime.combine(end_dt, datetime.time.max, tzinfo=datetime.timezone.utc)

    parent_query = (
        db.collection("property_data")
        .where("activity_date", ">=", start_ts)
        .where("activity_date", "<=", end_ts)
        .order_by("activity_date", direction=firestore.Query.DESCENDING)
    )

    identifier_map = {}
    lead_docs_by_path = {}
    parent_count = 0
    lead_count = 0

    for parent_snapshot in parent_query.stream():
        parent_data = parent_snapshot.to_dict() or {}
        if str(parent_data.get("property_id")) != str(property_id):
            continue

        parent_count += 1
        parent_date = parent_data.get("date")
        for lead_snapshot in parent_snapshot.reference.collection("leads").stream():
            wrapper = lead_snapshot.to_dict() or {}
            lead_data = wrapper.get("data", {}) or {}
            if is_guest_card_record(lead_data):
                continue
            identifiers = get_collection_identifiers(lead_data, LEAD_IDENTIFIER_KEYS)
            contact_fields = extract_lead_contact_fields(lead_data)
            if not identifiers and not any(contact_fields.values()):
                continue

            lead_count += 1
            lead_record = {
                "document_path": lead_snapshot.reference.path,
                "document_id": lead_snapshot.id,
                "parent_id": parent_snapshot.id,
                "parent_date": parent_date,
                "data": lead_data,
                "identifiers": identifiers,
                "application_id": normalize_string(lead_data.get("applicationId")),
                "lease_id": normalize_string(first_non_empty(lead_data.get("leaseId"), lead_data.get("leaseID"))),
                **contact_fields,
            }
            lead_docs_by_path[lead_snapshot.reference.path] = lead_record

            for identifier in identifiers:
                identifier_map.setdefault(identifier, []).append(lead_record)

    return {
        "identifier_map": identifier_map,
        "lead_docs_by_path": lead_docs_by_path,
        "parent_count": parent_count,
        "lead_count": lead_count,
    }

def get_primary_customer(customers):
    for customer in customers:
        if str(customer.get("customerType", "")).lower() == "primary":
            return customer
    return customers[0] if customers else {}

def build_lease_match_contact_fields(normalized_lease):
    return {
        "normalized_email": normalize_email(normalized_lease.get("resident_email")),
        "normalized_phone": normalize_phone(normalized_lease.get("resident_phone")),
        "normalized_full_name": normalize_full_name(
            first_non_empty(
                normalized_lease.get("resident_name"),
                " ".join(
                    part
                    for part in [
                        normalize_string(normalized_lease.get("resident_first_name")),
                        normalize_string(normalized_lease.get("resident_last_name")),
                    ]
                    if part
                ),
            )
        ),
    }

def get_match_proximity_days(lease_date, lead_parent_date):
    if not lease_date or not lead_parent_date:
        return 9999
    lead_date = parse_entrata_date(lead_parent_date)
    if not lead_date:
        return 9999
    return abs((lease_date - lead_date).days)

def normalize_lease_record(property_id, lease):
    lease_id = normalize_string(first_non_empty(lease.get("leaseId"), lease.get("id")))
    lease_interval_id = normalize_string(lease.get("leaseIntervalId"))

    lease_intervals = extract_nested_items({"leaseIntervals": lease.get("leaseIntervals")}, "leaseIntervals", "leaseInterval")
    lease_interval = lease_intervals[0] if lease_intervals else {}

    customers = extract_nested_items({"customers": lease.get("customers")}, "customers", "customer")
    primary_customer = get_primary_customer(customers)

    scheduled_charges = extract_nested_items({"scheduledCharges": lease.get("scheduledCharges")}, "scheduledCharges", "scheduledCharge")
    lease_activities = extract_nested_items({"leaseActivities": lease.get("leaseActivities")}, "leaseActivities", "leasesActivity")

    move_in_date = parse_entrata_date(first_non_empty(primary_customer.get("moveInDate"), lease_interval.get("startDate")))
    lease_start_date = parse_entrata_date(lease_interval.get("startDate"))
    lease_end_date = parse_entrata_date(lease_interval.get("endDate"))
    lease_approved_on = parse_entrata_date(lease_interval.get("leaseApprovedOn"))
    application_completed_on = parse_entrata_date(lease_interval.get("applicationCompletedOn"))
    lease_signed_on = None

    for activity in lease_activities:
        event_type = str(activity.get("eventType", "")).lower()
        description = str(activity.get("description", "")).lower()
        if event_type == "leasesigned" or "lease signed" in description:
            lease_signed_on = parse_entrata_date(activity.get("date"))
            if lease_signed_on:
                break

    attribution_event_date = first_non_empty(
        serialize_date(lease_signed_on),
        serialize_date(lease_approved_on),
        serialize_date(application_completed_on),
    )

    monthly_rent = 0.0
    monthly_base_rent = 0.0
    concession_total = 0.0
    recurring_charge_total = 0.0

    for charge in scheduled_charges:
        amount = parse_currency_amount(charge.get("amount"))
        charge_type = str(charge.get("chargeType", "")).lower()
        charge_code = str(charge.get("chargeCode", "")).lower()
        frequency = str(charge.get("frequency", "")).lower()

        if frequency == "monthly":
            recurring_charge_total += amount
            if charge_type == "base rent":
                monthly_base_rent += amount
                if charge_code == "rent":
                    monthly_rent += amount

        if "concession" in charge_code or "concession" in charge_type:
            concession_total += abs(amount)

    monthly_rent = monthly_rent or monthly_base_rent
    lease_term_months = calculate_month_span(lease_start_date, lease_end_date)
    gross_lease_value = round(monthly_base_rent * lease_term_months, 2) if lease_term_months else 0.0
    net_effective_rent = round((gross_lease_value - concession_total) / lease_term_months, 2) if lease_term_months else 0.0

    application_id = normalize_string(lease_interval.get("applicationId"))
    customer_ids = [
        normalize_string(customer.get("id"))
        for customer in customers
        if normalize_string(customer.get("id"))
    ]

    lease_identifiers = []
    for value in [
        application_id,
        lease_interval_id,
        lease_id,
        *customer_ids,
    ]:
        if value and value not in lease_identifiers:
            lease_identifiers.append(value)

    normalized = {
        "lease_id": lease_id,
        "lease_interval_id": lease_interval_id,
        "application_id": application_id,
        "property_id": property_id,
        "lease_status": normalize_string(first_non_empty(lease.get("leaseIntervalStatus"), lease_interval.get("leaseIntervalStatusTypeName"))),
        "lease_status_type_id": normalize_string(first_non_empty(lease.get("leaseStatusTypeId"), lease_interval.get("leaseIntervalStatusTypeId"))),
        "floor_plan_id": normalize_string(lease.get("floorPlanId")),
        "floor_plan_name": normalize_string(lease.get("floorPlanName")),
        "unit_id": normalize_string(lease.get("unitId")),
        "unit_number": normalize_string(lease.get("unitNumberSpace")),
        "unit_space_id": normalize_string(lease.get("unitSpaceId")),
        "move_in_date": serialize_date(move_in_date),
        "lease_start_date": serialize_date(lease_start_date),
        "lease_end_date": serialize_date(lease_end_date),
        "lease_approved_on": serialize_date(lease_approved_on),
        "lease_signed_on": serialize_date(lease_signed_on),
        "application_completed_on": serialize_date(application_completed_on),
        "attribution_event_date": attribution_event_date,
        "lease_term_months": lease_term_months,
        "monthly_rent": round(monthly_rent, 2),
        "monthly_base_rent": round(monthly_base_rent, 2),
        "monthly_recurring_charges": round(recurring_charge_total, 2),
        "concession_total": round(concession_total, 2),
        "gross_lease_value": gross_lease_value,
        "net_effective_rent": net_effective_rent,
        "currency_code": normalize_string(lease.get("currencyCode")),
        "resident_name": normalize_string(primary_customer.get("nameFull")),
        "resident_first_name": normalize_string(primary_customer.get("firstName")),
        "resident_last_name": normalize_string(primary_customer.get("lastName")),
        "resident_email": normalize_string(primary_customer.get("addresses", {}).get("address", {}).get("email")),
        "resident_phone": normalize_string(first_non_empty(primary_customer.get("phone", {}).get("phoneNumber"), primary_customer.get("addresses", {}).get("address", {}).get("phone", {}).get("phoneNumber"))),
        "customer_ids": customer_ids,
        "lease_identifiers": lease_identifiers,
        **build_lease_match_contact_fields({
            "resident_name": normalize_string(primary_customer.get("nameFull")),
            "resident_first_name": normalize_string(primary_customer.get("firstName")),
            "resident_last_name": normalize_string(primary_customer.get("lastName")),
            "resident_email": normalize_string(primary_customer.get("addresses", {}).get("address", {}).get("email")),
            "resident_phone": normalize_string(first_non_empty(primary_customer.get("phone", {}).get("phoneNumber"), primary_customer.get("addresses", {}).get("address", {}).get("phone", {}).get("phoneNumber"))),
        }),
        "raw_summary": {
            "customer_count": len(customers),
            "scheduled_charge_count": len(scheduled_charges),
            "lease_activity_count": len(lease_activities),
        },
        "raw": lease,
    }
    return normalized

def lease_is_in_reporting_window(normalized_lease, start_date, end_date):
    lease_status = str(normalized_lease.get("lease_status") or "").lower()
    if lease_status not in {"approved", "current"}:
        return False

    candidate_dates = [
        parse_entrata_date(normalized_lease.get("lease_signed_on")),
        parse_entrata_date(normalized_lease.get("lease_approved_on")),
        parse_entrata_date(normalized_lease.get("application_completed_on")),
    ]
    for candidate in candidate_dates:
        if candidate and start_date <= candidate <= end_date:
            return True
    return False

def correlate_lease_to_lead(normalized_lease, lead_index):
    lead_records = list(lead_index.get("lead_docs_by_path", {}).values())
    lease_date = parse_entrata_date(normalized_lease.get("attribution_event_date"))

    match_steps = [
        ("application_id", normalize_string(normalized_lease.get("application_id")), "application_id"),
        ("lease_id", normalize_string(normalized_lease.get("lease_id")), "lease_id"),
        ("normalized_email", normalize_email(normalized_lease.get("normalized_email")), "email"),
        ("normalized_phone", normalize_phone(normalized_lease.get("normalized_phone")), "phone"),
    ]

    for match_field, value, matched_identifier in match_steps:
        if not value:
            continue
        candidates = [
            lead_record
            for lead_record in lead_records
            if normalize_string(lead_record.get(match_field)) == value
        ]
        if candidates:
            candidates.sort(key=lambda item: item.get("parent_date") or "", reverse=True)
            lead_record = candidates[0]
            return build_correlation_response(lead_record, value, matched_identifier)

    normalized_name = normalize_full_name(normalized_lease.get("normalized_full_name"))
    if normalized_name:
        name_candidates = [
            lead_record
            for lead_record in lead_records
            if normalize_string(lead_record.get("normalized_full_name")) == normalized_name
        ]
        if name_candidates:
            name_candidates.sort(key=lambda item: (get_match_proximity_days(lease_date, item.get("parent_date")), -(int(item.get("parent_date", "0").replace("-", "")) if item.get("parent_date") else 0)))
            best_match = name_candidates[0]
            proximity_days = get_match_proximity_days(lease_date, best_match.get("parent_date"))
            if proximity_days <= 14:
                lead_record = best_match
                matched_identifier = f"{normalized_name}|{proximity_days}"
                return build_correlation_response(lead_record, matched_identifier, "name_date")

    return None

def build_correlation_response(lead_record, matched_identifier, match_type):
    lead_data = lead_record["data"]
    return {
        "match_type": match_type,
        "matched_identifier": matched_identifier,
        "lead_document_path": lead_record["document_path"],
        "lead_document_id": lead_record["document_id"],
        "lead_parent_id": lead_record["parent_id"],
        "lead_parent_date": lead_record["parent_date"],
        "lead_id": normalize_string(first_non_empty(lead_data.get("leadId"), lead_data.get("leadID"), lead_data.get("prospectId"), lead_data.get("prospectID"), lead_data.get("id"))),
        "application_id": normalize_string(lead_data.get("applicationId")),
        "lead_source": get_lead_source(lead_data),
        "lead_status": normalize_string(lead_data.get("status")),
        "internet_listing_service": normalize_string(lead_data.get("internetListingService")),
        "lead_data": lead_data,
    }

def upsert_normalized_lease(property_id, normalized_lease, correlation, window_start, window_end):
    db = firestore.client()
    lease_id = normalized_lease.get("lease_id")
    if not lease_id:
        return False

    lease_ref = (
        db.collection("properties")
        .document(str(property_id))
        .collection("leases")
        .document(str(lease_id))
    )

    doc = {
        **normalized_lease,
        "reporting_window_start": serialize_date(window_start),
        "reporting_window_end": serialize_date(window_end),
        "attribution_status": "matched" if correlation else "unmatched",
        "last_synced_at": firestore.SERVER_TIMESTAMP,
    }

    if correlation:
        source_classification = canonicalize_source_label(
            first_non_empty(correlation.get("lead_source"), correlation.get("internet_listing_service")),
            default_label="Unknown",
        )
        doc["lead_attribution"] = {
            "match_type": correlation.get("match_type"),
            "matched_identifier": correlation.get("matched_identifier"),
            "lead_document_path": correlation.get("lead_document_path"),
            "lead_document_id": correlation.get("lead_document_id"),
            "lead_parent_id": correlation.get("lead_parent_id"),
            "lead_parent_date": correlation.get("lead_parent_date"),
            "lead_id": correlation.get("lead_id"),
            "application_id": correlation.get("application_id"),
            "lead_source": correlation.get("lead_source"),
            "lead_status": correlation.get("lead_status"),
            "internet_listing_service": correlation.get("internet_listing_service"),
            "source_key": source_classification["source_key"],
            "source_label": source_classification["source_label"],
        }

    lease_ref.set(doc, merge=True)

    if correlation and correlation.get("lead_document_path"):
        lead_ref = db.document(correlation["lead_document_path"])
        lead_ref.set({
            "attribution": {
                "latest_lease_id": lease_id,
                "latest_lease_path": lease_ref.path,
                "last_linked_at": firestore.SERVER_TIMESTAMP,
            },
            "leaseIds": firestore.ArrayUnion([lease_id]),
            "leasePaths": firestore.ArrayUnion([lease_ref.path]),
        }, merge=True)

    return True

def sync_lease_attribution_for_property(property_id, start_date, end_date, lead_lookback_days=LEASE_ATTRIBUTION_LEAD_LOOKBACK_DAYS):
    query_end = end_date + datetime.timedelta(days=max(LEASE_ATTRIBUTION_FUTURE_MOVE_IN_DAYS, 0))
    params = {
        "propertyId": property_id,
        "moveInDateFrom": format_entrata_date(start_date),
        "moveInDateTo": format_entrata_date(query_end),
    }

    leases, meta = fetch_paginated_leases_for_range(property_id, params)
    lead_index = build_lead_index(property_id, lookback_days=lead_lookback_days)

    processed = 0
    matched = 0
    unmatched = 0
    skipped = 0

    for lease in leases:
        normalized_lease = normalize_lease_record(property_id, lease)
        if not normalized_lease.get("lease_id"):
            skipped += 1
            continue
        if not lease_is_in_reporting_window(normalized_lease, start_date, end_date):
            skipped += 1
            continue

        correlation = correlate_lease_to_lead(normalized_lease, lead_index)
        upsert_normalized_lease(property_id, normalized_lease, correlation, start_date, end_date)
        processed += 1
        if correlation:
            matched += 1
        else:
            unmatched += 1

    return {
        "property_id": property_id,
        "queried_move_in_start": serialize_date(start_date),
        "queried_move_in_end": serialize_date(query_end),
        "reporting_window_start": serialize_date(start_date),
        "reporting_window_end": serialize_date(end_date),
        "leases_fetched": len(leases),
        "leases_processed": processed,
        "leases_matched": matched,
        "leases_unmatched": unmatched,
        "leases_skipped": skipped,
        "lead_lookup_docs": lead_index.get("lead_count", 0),
        "lead_lookup_parents": lead_index.get("parent_count", 0),
        "meta": meta,
    }

def sync_lease_attribution(property_ids, start_date=None, end_date=None, lead_lookback_days=LEASE_ATTRIBUTION_LEAD_LOOKBACK_DAYS):
    if end_date is None:
        end_date = get_local_now().date()
    if start_date is None:
        start_date = end_date - datetime.timedelta(days=max(LEASE_ATTRIBUTION_LOOKBACK_DAYS - 1, 0))

    results = []
    for property_id in property_ids:
        results.append(sync_lease_attribution_for_property(property_id, start_date, end_date, lead_lookback_days=lead_lookback_days))
        time.sleep(2)
    return results

def daterange(start_date, end_date):
    current = start_date
    while current <= end_date:
        yield current
        current += datetime.timedelta(days=1)

def build_daily_roi_buckets(property_id, start_date, end_date):
    buckets = {}
    for day in daterange(start_date, end_date):
        date_id = serialize_date(day)
        activity_dt = datetime.datetime.combine(day, datetime.time.min, tzinfo=datetime.timezone.utc)
        buckets[date_id] = {
            "date": date_id,
            "activity_date": activity_dt,
            "property_id": property_id,
            "totals": {
                "attributed_leases": 0,
                "unattributed_leases": 0,
                "gross_lease_value": 0.0,
                "net_effective_revenue": 0.0,
                "concession_total": 0.0,
                "marketing_spend": 0.0,
                "performance_marketing_spend": 0.0,
                "roi": None,
            },
            "source_metrics": {},
            "invoice_channels": {},
        }
    return buckets

def get_source_metric_bucket(container, source_key, source_label):
    if source_key not in container:
        container[source_key] = {
            "source_key": source_key,
            "source_label": source_label,
            "attributed_leases": 0,
            "gross_lease_value": 0.0,
            "net_effective_revenue": 0.0,
            "concession_total": 0.0,
            "marketing_spend": 0.0,
            "performance_marketing_spend": 0.0,
            "roi": None,
        }
    return container[source_key]

def stream_property_leases(property_id):
    db = firestore.client()
    return db.collection("properties").document(str(property_id)).collection("leases").stream()

def load_property_invoices(property_id, start_date, end_date):
    db = firestore.client()
    month_start, _ = get_month_range_for_date(start_date)
    _, month_end = get_month_range_for_date(end_date)
    start_ts = datetime.datetime.combine(month_start, datetime.time.min, tzinfo=datetime.timezone.utc)
    end_ts = datetime.datetime.combine(month_end, datetime.time.max, tzinfo=datetime.timezone.utc)

    parent_query = (
        db.collection("property_data")
        .where("activity_date", ">=", start_ts)
        .where("activity_date", "<=", end_ts)
        .order_by("activity_date", direction=firestore.Query.ASCENDING)
    )

    invoices_by_key = {}
    parent_count = 0

    for parent_snapshot in parent_query.stream():
        parent_data = parent_snapshot.to_dict() or {}
        if str(parent_data.get("property_id")) != str(property_id):
            continue

        parent_count += 1
        for invoice_snapshot in parent_snapshot.reference.collection("invoices").stream():
            wrapper = invoice_snapshot.to_dict() or {}
            invoice = wrapper.get("data", {}) or {}
            invoice["_date"] = parent_data.get("date")
            invoice_key = get_invoice_key(invoice)
            existing = invoices_by_key.get(invoice_key)
            if existing is None:
                invoices_by_key[invoice_key] = invoice
                continue

            existing_date = get_invoice_effective_date(existing)
            next_date = get_invoice_effective_date(invoice)
            if next_date and (existing_date is None or next_date < existing_date):
                invoices_by_key[invoice_key] = invoice

    return list(invoices_by_key.values()), parent_count

def apply_invoice_spend_to_buckets(buckets, invoice, start_date, end_date):
    if not has_invoice_classification(invoice, ALL_MARKETING_GL_CODES, ALL_MARKETING_DESCRIPTIONS):
        return

    amount = get_invoice_amount(invoice)
    if amount == 0:
        return

    allocation_start, allocation_end = get_invoice_allocation_month(invoice)
    if not allocation_start or not allocation_end:
        return

    overlap_start = max(allocation_start, start_date)
    overlap_end = min(allocation_end, end_date)
    if overlap_start > overlap_end:
        return

    total_days = max(count_inclusive_days(allocation_start, allocation_end), 1)
    daily_amount = amount / total_days
    is_performance = (
        has_invoice_classification(invoice, PERFORMANCE_MARKETING_GL_CODES, PERFORMANCE_MARKETING_DESCRIPTIONS)
        and is_active_advertising_invoice(invoice)
    )
    channel = classify_invoice_channel(invoice)

    for day in daterange(overlap_start, overlap_end):
        date_id = serialize_date(day)
        bucket = buckets.get(date_id)
        if bucket is None:
            continue

        bucket["totals"]["marketing_spend"] += daily_amount
        if is_performance:
            bucket["totals"]["performance_marketing_spend"] += daily_amount

        channel_bucket = get_source_metric_bucket(
            bucket["invoice_channels"],
            channel["source_key"],
            channel["source_label"],
        )
        channel_bucket["marketing_spend"] += daily_amount
        if is_performance:
            channel_bucket["performance_marketing_spend"] += daily_amount

        source_bucket = get_source_metric_bucket(
            bucket["source_metrics"],
            channel["source_key"],
            channel["source_label"],
        )
        source_bucket["marketing_spend"] += daily_amount
        if is_performance:
            source_bucket["performance_marketing_spend"] += daily_amount

def apply_lease_revenue_to_buckets(buckets, lease_doc):
    event_date = parse_entrata_date(lease_doc.get("attribution_event_date"))
    if not event_date:
        return False

    date_id = serialize_date(event_date)
    bucket = buckets.get(date_id)
    if bucket is None:
        return False

    gross_value = float(lease_doc.get("gross_lease_value") or 0.0)
    net_value = float(lease_doc.get("net_effective_rent") or 0.0) * float(lease_doc.get("lease_term_months") or 0.0)
    concessions = float(lease_doc.get("concession_total") or 0.0)
    attribution_status = lease_doc.get("attribution_status")

    if attribution_status == "matched":
        bucket["totals"]["attributed_leases"] += 1
        bucket["totals"]["gross_lease_value"] += gross_value
        bucket["totals"]["net_effective_revenue"] += net_value
        bucket["totals"]["concession_total"] += concessions

        lead_attribution = lease_doc.get("lead_attribution", {}) if isinstance(lease_doc.get("lead_attribution"), dict) else {}
        source_key = lead_attribution.get("source_key") or canonicalize_source_label(
            first_non_empty(lead_attribution.get("lead_source"), lead_attribution.get("internet_listing_service")),
            default_label="Unknown",
        )["source_key"]
        source_label = lead_attribution.get("source_label") or canonicalize_source_label(
            first_non_empty(lead_attribution.get("lead_source"), lead_attribution.get("internet_listing_service")),
            default_label="Unknown",
        )["source_label"]

        source_bucket = get_source_metric_bucket(bucket["source_metrics"], source_key, source_label)
        source_bucket["attributed_leases"] += 1
        source_bucket["gross_lease_value"] += gross_value
        source_bucket["net_effective_revenue"] += net_value
        source_bucket["concession_total"] += concessions
    else:
        bucket["totals"]["unattributed_leases"] += 1

    return True

def finalize_roi_bucket(bucket):
    marketing_spend = bucket["totals"]["marketing_spend"]
    net_revenue = bucket["totals"]["net_effective_revenue"]
    if marketing_spend > 0:
        bucket["totals"]["roi"] = round((net_revenue - marketing_spend) / marketing_spend, 4)

    source_metrics = []
    for item in bucket["source_metrics"].values():
        if item["marketing_spend"] > 0:
            item["roi"] = round((item["net_effective_revenue"] - item["marketing_spend"]) / item["marketing_spend"], 4)
        source_metrics.append({
            **item,
            "gross_lease_value": round(item["gross_lease_value"], 2),
            "net_effective_revenue": round(item["net_effective_revenue"], 2),
            "concession_total": round(item["concession_total"], 2),
            "marketing_spend": round(item["marketing_spend"], 2),
            "performance_marketing_spend": round(item["performance_marketing_spend"], 2),
        })

    invoice_channels = []
    for item in bucket["invoice_channels"].values():
        invoice_channels.append({
            **item,
            "marketing_spend": round(item["marketing_spend"], 2),
            "performance_marketing_spend": round(item["performance_marketing_spend"], 2),
        })

    source_metrics.sort(key=lambda item: item["net_effective_revenue"], reverse=True)
    invoice_channels.sort(key=lambda item: item["marketing_spend"], reverse=True)

    bucket["source_metrics"] = source_metrics
    bucket["invoice_channels"] = invoice_channels
    bucket["totals"]["gross_lease_value"] = round(bucket["totals"]["gross_lease_value"], 2)
    bucket["totals"]["net_effective_revenue"] = round(bucket["totals"]["net_effective_revenue"], 2)
    bucket["totals"]["concession_total"] = round(bucket["totals"]["concession_total"], 2)
    bucket["totals"]["marketing_spend"] = round(bucket["totals"]["marketing_spend"], 2)
    bucket["totals"]["performance_marketing_spend"] = round(bucket["totals"]["performance_marketing_spend"], 2)
    return bucket

def write_roi_buckets(property_id, buckets):
    db = firestore.client()
    roi_ref = db.collection("properties").document(str(property_id)).collection("roi_daily")
    batch = db.batch()
    count = 0

    for date_id in sorted(buckets.keys()):
        bucket = finalize_roi_bucket(buckets[date_id])
        batch.set(roi_ref.document(date_id), {
            **bucket,
            "last_aggregated_at": firestore.SERVER_TIMESTAMP,
        }, merge=True)
        count += 1
        if count >= 450:
            batch.commit()
            batch = db.batch()
            count = 0

    if count > 0:
        batch.commit()

def aggregate_roi_for_property(property_id, start_date, end_date):
    buckets = build_daily_roi_buckets(property_id, start_date, end_date)
    processed_leases = 0
    processed_invoices = 0

    for lease_snapshot in stream_property_leases(property_id):
        lease_doc = lease_snapshot.to_dict() or {}
        event_date = parse_entrata_date(lease_doc.get("attribution_event_date"))
        if not event_date or event_date < start_date or event_date > end_date:
            continue
        if apply_lease_revenue_to_buckets(buckets, lease_doc):
            processed_leases += 1

    invoices, invoice_parent_count = load_property_invoices(property_id, start_date, end_date)
    for invoice in invoices:
        apply_invoice_spend_to_buckets(buckets, invoice, start_date, end_date)
        processed_invoices += 1

    write_roi_buckets(property_id, buckets)

    totals = {
        "attributed_leases": 0,
        "unattributed_leases": 0,
        "gross_lease_value": 0.0,
        "net_effective_revenue": 0.0,
        "concession_total": 0.0,
        "marketing_spend": 0.0,
        "performance_marketing_spend": 0.0,
    }
    for bucket in buckets.values():
        for key in totals.keys():
            totals[key] += bucket["totals"].get(key, 0) or 0

    roi = None
    if totals["marketing_spend"] > 0:
        roi = round((totals["net_effective_revenue"] - totals["marketing_spend"]) / totals["marketing_spend"], 4)

    return {
        "property_id": property_id,
        "start_date": serialize_date(start_date),
        "end_date": serialize_date(end_date),
        "days_written": len(buckets),
        "leases_aggregated": processed_leases,
        "invoices_aggregated": processed_invoices,
        "invoice_parent_docs": invoice_parent_count,
        "totals": {
            **{key: round(value, 2) if isinstance(value, float) else value for key, value in totals.items()},
            "roi": roi,
        },
    }

def aggregate_roi(property_ids, start_date=None, end_date=None):
    if end_date is None:
        end_date = get_local_now().date()
    if start_date is None:
        start_date = end_date - datetime.timedelta(days=max(LEASE_ATTRIBUTION_LOOKBACK_DAYS - 1, 0))

    summaries = []
    for property_id in property_ids:
        summaries.append(aggregate_roi_for_property(property_id, start_date, end_date))
        time.sleep(1)
    return summaries

def get_roi_pipeline_state(job_name):
    state_ref = get_state_doc(job_name)
    snapshot = state_ref.get()
    state = snapshot.to_dict() or {} if snapshot.exists else {}
    return state_ref, state

def start_roi_pipeline_job(
    job_name,
    property_ids,
    raw_start_date,
    raw_end_date,
    report_start_date,
    report_end_date,
    initiated_by="manual",
):
    state_ref, _ = get_roi_pipeline_state(job_name)
    state = {
        "job_name": job_name,
        "active": True,
        "completed": False,
        "phase": "raw",
        "initiated_by": initiated_by,
        "property_ids": [int(property_id) for property_id in property_ids],
        "raw_start_date": serialize_date(raw_start_date),
        "raw_end_date": serialize_date(raw_end_date),
        "report_start_date": serialize_date(report_start_date),
        "report_end_date": serialize_date(report_end_date),
        "raw_day_index": 0,
        "raw_property_index": 0,
        "attribution_property_index": 0,
        "aggregate_property_index": 0,
        "raw_batch_size": ROI_PIPELINE_RAW_BATCH_SIZE,
        "property_batch_size": ROI_PIPELINE_PROPERTY_BATCH_SIZE,
        "started_at": firestore.SERVER_TIMESTAMP,
        "last_processed_at": None,
        "last_summary": None,
    }
    state_ref.set(state, merge=False)
    return state_ref, state

def process_roi_pipeline_job(job_name):
    state_ref, state = get_roi_pipeline_state(job_name)
    if not state or not state.get("active"):
        return f"{job_name}: inactive"

    property_ids = [int(property_id) for property_id in state.get("property_ids", [])]
    if not property_ids:
        state_ref.set({
            "active": False,
            "completed": True,
            "phase": "done",
            "last_summary": "No property IDs configured.",
            "last_processed_at": firestore.SERVER_TIMESTAMP,
        }, merge=True)
        return f"{job_name}: no property IDs configured"

    raw_start_date = parse_iso_date(state.get("raw_start_date"))
    raw_end_date = parse_iso_date(state.get("raw_end_date"))
    report_start_date = parse_iso_date(state.get("report_start_date"))
    report_end_date = parse_iso_date(state.get("report_end_date"))
    phase = state.get("phase", "raw")
    raw_batch_size = max(int(state.get("raw_batch_size", ROI_PIPELINE_RAW_BATCH_SIZE)), 1)
    property_batch_size = max(int(state.get("property_batch_size", ROI_PIPELINE_PROPERTY_BATCH_SIZE)), 1)

    if not raw_start_date or not raw_end_date or not report_start_date or not report_end_date:
        raise ValueError(f"{job_name}: invalid pipeline dates")

    summary = ""

    if phase == "raw":
        total_days = (raw_end_date - raw_start_date).days + 1
        raw_day_index = int(state.get("raw_day_index", 0))
        raw_property_index = int(state.get("raw_property_index", 0))
        processed = 0
        errors = 0

        while processed < raw_batch_size and raw_day_index < total_days:
            current_date = raw_start_date + datetime.timedelta(days=raw_day_index)
            property_id = property_ids[raw_property_index]
            date_str = format_entrata_date(current_date)

            try:
                print(f"{job_name}: raw sync property {property_id} for {date_str}")
                sync_property_date_for_roi(property_id, date_str)
                processed += 1
            except Exception as e:
                errors += 1
                print(f"{job_name}: raw sync error on property {property_id} for {date_str}: {str(e)}")
                queue_retry_job(job_name, property_id, date_str, str(e))

            raw_property_index += 1
            if raw_property_index >= len(property_ids):
                raw_property_index = 0
                raw_day_index += 1
            time.sleep(1)

        phase_complete = raw_day_index >= total_days
        next_phase = "attribution" if phase_complete else "raw"
        state_ref.set({
            "phase": next_phase,
            "raw_day_index": raw_day_index,
            "raw_property_index": raw_property_index,
            "last_processed_at": firestore.SERVER_TIMESTAMP,
            "last_summary": f"raw processed={processed}, errors={errors}, next_day_index={raw_day_index}, next_property_index={raw_property_index}",
        }, merge=True)
        summary = f"{job_name}: raw processed={processed}, errors={errors}"
        phase = next_phase

    if phase == "attribution":
        attribution_property_index = int(state.get("attribution_property_index", 0))
        processed = 0
        errors = 0
        last_results = []
        lead_lookback_days = max(
            LEASE_ATTRIBUTION_LEAD_LOOKBACK_DAYS,
            (report_end_date - report_start_date).days + 90,
        )

        while processed < property_batch_size and attribution_property_index < len(property_ids):
            property_id = property_ids[attribution_property_index]
            try:
                print(f"{job_name}: attribution sync for property {property_id}")
                result = sync_lease_attribution_for_property(
                    property_id,
                    report_start_date,
                    report_end_date,
                    lead_lookback_days=lead_lookback_days,
                )
                last_results.append(result)
                processed += 1
            except Exception as e:
                errors += 1
                print(f"{job_name}: attribution error on property {property_id}: {str(e)}")
            attribution_property_index += 1
            time.sleep(1)

        phase_complete = attribution_property_index >= len(property_ids)
        next_phase = "aggregate" if phase_complete else "attribution"
        state_ref.set({
            "phase": next_phase,
            "attribution_property_index": attribution_property_index,
            "last_processed_at": firestore.SERVER_TIMESTAMP,
            "last_summary": f"attribution processed={processed}, errors={errors}, next_property_index={attribution_property_index}",
            "last_attribution_results": last_results[-3:],
        }, merge=True)
        summary = f"{job_name}: attribution processed={processed}, errors={errors}"
        phase = next_phase

    if phase == "aggregate":
        aggregate_property_index = int(state.get("aggregate_property_index", 0))
        processed = 0
        errors = 0
        last_results = []

        while processed < property_batch_size and aggregate_property_index < len(property_ids):
            property_id = property_ids[aggregate_property_index]
            try:
                print(f"{job_name}: ROI aggregate for property {property_id}")
                result = aggregate_roi_for_property(property_id, report_start_date, report_end_date)
                last_results.append(result)
                processed += 1
            except Exception as e:
                errors += 1
                print(f"{job_name}: ROI aggregate error on property {property_id}: {str(e)}")
            aggregate_property_index += 1
            time.sleep(1)

        phase_complete = aggregate_property_index >= len(property_ids)
        state_ref.set({
            "phase": "done" if phase_complete else "aggregate",
            "aggregate_property_index": aggregate_property_index,
            "active": not phase_complete,
            "completed": phase_complete,
            "completed_at": firestore.SERVER_TIMESTAMP if phase_complete else None,
            "last_processed_at": firestore.SERVER_TIMESTAMP,
            "last_summary": f"aggregate processed={processed}, errors={errors}, next_property_index={aggregate_property_index}",
            "last_aggregate_results": last_results[-3:],
        }, merge=True)
        summary = f"{job_name}: aggregate processed={processed}, errors={errors}"

    return summary or f"{job_name}: no work"

def get_roi_pipeline_status_payload():
    ytd_ref, ytd_state = get_roi_pipeline_state("roi_ytd_backfill")
    daily_ref, daily_state = get_roi_pipeline_state("roi_daily_refresh")

    def summarize_state(job_name, state):
        property_ids = state.get("property_ids", []) if isinstance(state, dict) else []
        total_properties = len(property_ids)
        raw_start = parse_iso_date(state.get("raw_start_date")) if isinstance(state, dict) else None
        raw_end = parse_iso_date(state.get("raw_end_date")) if isinstance(state, dict) else None
        total_days = ((raw_end - raw_start).days + 1) if raw_start and raw_end else None
        raw_day_index = int(state.get("raw_day_index", 0) or 0) if isinstance(state, dict) else 0
        attribution_index = int(state.get("attribution_property_index", 0) or 0) if isinstance(state, dict) else 0
        aggregate_index = int(state.get("aggregate_property_index", 0) or 0) if isinstance(state, dict) else 0
        phase = state.get("phase", "unknown") if isinstance(state, dict) else "unknown"

        progress = {}
        if total_days is not None:
            progress["raw_days_processed"] = min(raw_day_index, total_days)
            progress["raw_days_total"] = total_days
        if total_properties:
            progress["attribution_properties_processed"] = min(attribution_index, total_properties)
            progress["attribution_properties_total"] = total_properties
            progress["aggregate_properties_processed"] = min(aggregate_index, total_properties)
            progress["aggregate_properties_total"] = total_properties

        return {
            "job_name": job_name,
            "active": bool(state.get("active")) if isinstance(state, dict) else False,
            "completed": bool(state.get("completed")) if isinstance(state, dict) else False,
            "phase": phase,
            "initiated_by": state.get("initiated_by") if isinstance(state, dict) else None,
            "raw_start_date": state.get("raw_start_date") if isinstance(state, dict) else None,
            "raw_end_date": state.get("raw_end_date") if isinstance(state, dict) else None,
            "report_start_date": state.get("report_start_date") if isinstance(state, dict) else None,
            "report_end_date": state.get("report_end_date") if isinstance(state, dict) else None,
            "last_summary": state.get("last_summary") if isinstance(state, dict) else None,
            "last_processed_at": state.get("last_processed_at") if isinstance(state, dict) else None,
            "started_at": state.get("started_at") if isinstance(state, dict) else None,
            "completed_at": state.get("completed_at") if isinstance(state, dict) else None,
            "property_count": total_properties,
            "progress": progress,
        }

    return {
        "roi_ytd_backfill": summarize_state("roi_ytd_backfill", ytd_state),
        "roi_daily_refresh": summarize_state("roi_daily_refresh", daily_state),
    }

def sync_property_date(property_id, date_str):
    fetch_leads_for_date(property_id, date_str)
    fetch_events_for_date(property_id, date_str)
    fetch_leases_for_date(property_id, date_str)
    fetch_invoices_for_date(property_id, date_str)
    # Keep daily refresh focused on the core reporting entities. Availability
    # requests are handled by dedicated jobs and have known Entrata quirks that
    # can create noisy failures without helping the refresh path.

def property_day_doc_exists(property_id, date_id):
    db = firestore.client()
    return db.collection("property_data").document(f"{property_id}_{date_id}").get().exists

def get_state_doc(name):
    db = firestore.client()
    return db.collection(SYNC_STATE_COLLECTION).document(name)

def build_retry_doc_id(job_type, property_id, date_id):
    return f"{job_type}_{property_id}_{date_id}"

def queue_retry_job(job_type, property_id, date_str, error_message):
    db = firestore.client()
    date_id = datetime.datetime.strptime(date_str, "%m/%d/%Y").strftime("%Y-%m-%d")
    doc_id = build_retry_doc_id(job_type, property_id, date_id)
    doc_ref = db.collection(SYNC_RETRY_COLLECTION).document(doc_id)
    snapshot = doc_ref.get()
    attempts = 0
    if snapshot.exists:
        attempts = int((snapshot.to_dict() or {}).get("attempts", 0))

    doc_ref.set({
        "job_type": job_type,
        "property_id": property_id,
        "date_id": date_id,
        "date_str": date_str,
        "attempts": attempts + 1,
        "last_error": error_message,
        "last_queued_at": firestore.SERVER_TIMESTAMP,
    }, merge=True)

def get_retry_jobs(limit):
    db = firestore.client()
    jobs = []
    for snapshot in db.collection(SYNC_RETRY_COLLECTION).stream():
        data = snapshot.to_dict() or {}
        jobs.append((snapshot, data))

    jobs.sort(
        key=lambda item: (
            int(item[1].get("abandoned", False)),
            int(item[1].get("attempts", 0)),
            str(item[1].get("last_queued_at", "")),
        )
    )
    return [snapshot for snapshot, _ in jobs[:limit]]

def is_permanent_retry_failure(error_message):
    message = str(error_message or "")
    normalized = message.lower()

    if "403 client error" in normalized:
        return True

    # Availability failures for this Entrata endpoint are non-blocking now and
    # should not continue to churn through the retry queue.
    if "400 client error" in normalized and "/v1/properties" in normalized:
        return True

    return False

def process_retry_queue_batch():
    db = firestore.client()
    jobs = get_retry_jobs(max(RETRY_BATCH_SIZE, 1))
    processed = 0
    cleared = 0
    errors = 0
    abandoned = 0

    for snapshot in jobs:
        data = snapshot.to_dict() or {}
        job_type = data.get("job_type", "background_backfill")
        property_id = int(data["property_id"])
        date_str = data["date_str"]
        attempts = int(data.get("attempts", 1))

        try:
            print(f"Retry queue syncing property {property_id} for {date_str} (attempt {attempts})")
            sync_property_date(property_id, date_str)
            snapshot.reference.delete()
            processed += 1
            cleared += 1
        except Exception as e:
            errors += 1
            permanent_failure = is_permanent_retry_failure(str(e))
            if permanent_failure or attempts >= RETRY_MAX_ATTEMPTS:
                snapshot.reference.set({
                    "abandoned": True,
                    "abandoned_at": firestore.SERVER_TIMESTAMP,
                    "last_error": str(e),
                    "abandon_reason": "permanent_failure" if permanent_failure else "max_attempts",
                }, merge=True)
                abandoned += 1
            else:
                snapshot.reference.set({
                    "attempts": attempts + 1,
                    "last_error": str(e),
                    "last_queued_at": firestore.SERVER_TIMESTAMP,
                }, merge=True)
            time.sleep(2)

    return (
        f"Retry queue processed={processed}, cleared={cleared}, errors={errors}, "
        f"abandoned={abandoned}, remaining_checked={len(jobs)}"
    )

def get_background_backfill_state():
    state_ref = get_state_doc("entrata_background_backfill")
    snapshot = state_ref.get()
    total_days = max(BACKGROUND_BACKFILL_TOTAL_DAYS, 1)
    if snapshot.exists:
        state = snapshot.to_dict() or {}
    else:
        state = {}

    state.setdefault("active", True)
    state.setdefault("batch_size", BACKGROUND_BACKFILL_BATCH_SIZE)
    state.setdefault("total_days", total_days)
    state.setdefault("next_day_offset", total_days - 1)
    state.setdefault("next_property_index", 0)
    return state_ref, state

def process_background_backfill_batch():
    state_ref, state = get_background_backfill_state()
    if not state.get("active", True):
        return "Background backfill paused."

    property_ids = get_automation_property_ids()
    if not property_ids:
        return "No property IDs configured."

    processed = 0
    skipped = 0
    errors = 0
    batch_size = max(int(state.get("batch_size", BACKGROUND_BACKFILL_BATCH_SIZE)), 1)

    while processed < batch_size and state["next_day_offset"] >= 0:
        property_id = property_ids[state["next_property_index"]]
        date_offset = int(state["next_day_offset"])
        date_id = get_firestore_date_id_from_offset(date_offset)
        date_str = get_request_date_from_offset(date_offset)

        try:
            if property_day_doc_exists(property_id, date_id):
                skipped += 1
            else:
                print(f"Background backfill syncing property {property_id} for {date_str}")
                sync_property_date(property_id, date_str)
                processed += 1
        except Exception as e:
            errors += 1
            print(f"Background backfill error on property {property_id} for {date_str}: {str(e)}")
            queue_retry_job("background_backfill", property_id, date_str, str(e))

        state["next_property_index"] += 1
        if state["next_property_index"] >= len(property_ids):
            state["next_property_index"] = 0
            state["next_day_offset"] -= 1

        time.sleep(2)

    completed = state["next_day_offset"] < 0
    state.update({
        "completed": completed,
        "active": not completed,
        "last_processed_at": firestore.SERVER_TIMESTAMP,
        "last_processed_count": processed,
        "last_skipped_count": skipped,
        "last_error_count": errors,
    })
    state_ref.set(state, merge=True)

    return (
        f"Background backfill processed={processed}, skipped={skipped}, errors={errors}, "
        f"next_day_offset={state.get('next_day_offset')}, next_property_index={state.get('next_property_index')}"
    )

def get_daily_refresh_state():
    state_ref = get_state_doc("entrata_daily_refresh")
    snapshot = state_ref.get()
    run_date = get_local_now().strftime("%Y-%m-%d")
    target_offsets = list(range(1, max(DAILY_REFRESH_LOOKBACK_DAYS, 1) + 1))

    if snapshot.exists:
        state = snapshot.to_dict() or {}
    else:
        state = {}

    if state.get("run_date") != run_date:
        state = {
            "run_date": run_date,
            "target_offsets": target_offsets,
            "offset_index": 0,
            "property_index": 0,
            "completed": False,
            "batch_size": DAILY_REFRESH_BATCH_SIZE,
        }
    else:
        state.setdefault("target_offsets", target_offsets)
        state.setdefault("offset_index", 0)
        state.setdefault("property_index", 0)
        state.setdefault("completed", False)
        state.setdefault("batch_size", DAILY_REFRESH_BATCH_SIZE)

    return state_ref, state

def process_daily_refresh_batch():
    state_ref, state = get_daily_refresh_state()
    if state.get("completed"):
        return f"Daily refresh already complete for {state['run_date']}."

    property_ids = get_automation_property_ids()
    if not property_ids:
        return "No property IDs configured."

    target_offsets = state.get("target_offsets", [1])
    processed = 0
    errors = 0
    batch_size = max(int(state.get("batch_size", DAILY_REFRESH_BATCH_SIZE)), 1)

    while processed < batch_size and state["offset_index"] < len(target_offsets):
        property_id = property_ids[state["property_index"]]
        day_offset = int(target_offsets[state["offset_index"]])
        date_str = get_request_date_from_offset(day_offset)

        try:
            print(f"Daily refresh syncing property {property_id} for {date_str}")
            sync_property_date(property_id, date_str)
            processed += 1
        except Exception as e:
            errors += 1
            print(f"Daily refresh error on property {property_id} for {date_str}: {str(e)}")
            queue_retry_job("daily_refresh", property_id, date_str, str(e))

        state["property_index"] += 1
        if state["property_index"] >= len(property_ids):
            state["property_index"] = 0
            state["offset_index"] += 1

        time.sleep(2)

    completed = state["offset_index"] >= len(target_offsets)
    state.update({
        "completed": completed,
        "last_processed_at": firestore.SERVER_TIMESTAMP,
        "last_processed_count": processed,
        "last_error_count": errors,
    })
    state_ref.set(state, merge=True)

    return (
        f"Daily refresh run_date={state['run_date']}, processed={processed}, errors={errors}, "
        f"offset_index={state.get('offset_index')}, property_index={state.get('property_index')}, completed={completed}"
    )

def save_raw_data(property_id, subcollection_name, item_list, date_str):
    db = firestore.client()
    # Convert MM/DD/YYYY to YYYY-MM-DD for doc ID
    d_obj = datetime.datetime.strptime(date_str, "%m/%d/%Y")
    date_id = d_obj.strftime("%Y-%m-%d")
    doc_id = f"{property_id}_{date_id}"
    
    parent_ref = db.collection("property_data").document(doc_id)
    # Use native datetime (Firestore handles this automatically)
    activity_dt = datetime.datetime.strptime(date_id, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc)
    
    parent_ref.set({
        "property_id": property_id,
        "date": date_id,
        "activity_date": activity_dt,
        "last_updated": firestore.SERVER_TIMESTAMP
    }, merge=True)
    
    subcol_ref = parent_ref.collection(subcollection_name)
    batch = db.batch()
    count = 0
    
    for index, item in enumerate(item_list):
        if not item: continue
        item_doc_id = build_item_document_id(subcollection_name, item)
        doc_ref = subcol_ref.document(item_doc_id) if item_doc_id else subcol_ref.document(f"generated_{index}")
        # Item also needs the activity_dt
        batch.set(doc_ref, {
            "data": item,
            "property_id": property_id,
            "activity_date": activity_dt,
            "timestamp": firestore.SERVER_TIMESTAMP
        })
        count += 1
        if count >= 450:
            batch.commit()
            batch = db.batch()
            count = 0
    if count > 0: batch.commit()

def get_sync_window_from_request(req, default_days=LEASE_ATTRIBUTION_LOOKBACK_DAYS):
    end_date = parse_entrata_date(req.args.get("end_date"))
    start_date = parse_entrata_date(req.args.get("start_date"))
    days = req.args.get("days")

    if end_date is None:
        end_date = get_local_now().date()

    if start_date is None:
        if days is not None:
            start_date = end_date - datetime.timedelta(days=max(int(days) - 1, 0))
        else:
            start_date = end_date - datetime.timedelta(days=max(default_days - 1, 0))

    if start_date > end_date:
        raise ValueError("start_date must be on or before end_date")

    return start_date, end_date

def get_target_property_ids(req=None):
    if req is None:
        return [ENTRATA_PROPERTY_ID]

    if req.args.get("all_properties") == "1":
        return get_automation_property_ids()

    property_ids_arg = req.args.get("property_ids")
    if property_ids_arg:
        return [
            int(property_id.strip())
            for property_id in property_ids_arg.split(",")
            if property_id.strip()
        ]

    return [int(req.args.get("property_id", ENTRATA_PROPERTY_ID))]

@scheduler_fn.on_schedule(schedule="0 2 * * *", timezone="America/Denver", secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"])
def fetch_daily_entrata_leads_scheduled(event: scheduler_fn.ScheduledEvent) -> None:
    init_firebase()
    today_str = datetime.datetime.now().strftime("%m/%d/%Y")
    fetch_leads_for_date(ENTRATA_PROPERTY_ID, today_str)

@scheduler_fn.on_schedule(schedule="0 2 * * *", timezone="America/Denver", secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"])
def fetch_daily_entrata_events_scheduled(event: scheduler_fn.ScheduledEvent) -> None:
    init_firebase()
    today_str = datetime.datetime.now().strftime("%m/%d/%Y")
    fetch_events_for_date(ENTRATA_PROPERTY_ID, today_str)

@scheduler_fn.on_schedule(schedule="0 2 * * *", timezone="America/Denver", secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"])
def fetch_daily_entrata_leases_scheduled(event: scheduler_fn.ScheduledEvent) -> None:
    init_firebase()
    today_str = datetime.datetime.now().strftime("%m/%d/%Y")
    fetch_leases_for_date(ENTRATA_PROPERTY_ID, today_str)

@scheduler_fn.on_schedule(schedule="0 2 * * *", timezone="America/Denver", secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"])
def fetch_daily_entrata_invoices_scheduled(event: scheduler_fn.ScheduledEvent) -> None:
    init_firebase()
    today_str = datetime.datetime.now().strftime("%m/%d/%Y")
    fetch_invoices_for_date(ENTRATA_PROPERTY_ID, today_str)

@scheduler_fn.on_schedule(schedule="0 2 * * *", timezone="America/Denver", secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"])
def fetch_daily_entrata_availability_scheduled(event: scheduler_fn.ScheduledEvent) -> None:
    init_firebase()
    today_str = datetime.datetime.now().strftime("%m/%d/%Y")
    fetch_availability_for_date(ENTRATA_PROPERTY_ID, today_str)

@scheduler_fn.on_schedule(schedule="10 1 * * *", timezone="America/Denver", secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"])
def sync_daily_entrata_specials_scheduled(event: scheduler_fn.ScheduledEvent) -> None:
    init_firebase()
    summaries = []
    for property_id in get_automation_property_ids():
        try:
            summaries.append(fetch_specials(property_id))
            time.sleep(1)
        except Exception as e:
            summaries.append({
                "property_id": property_id,
                "changed": False,
                "error": str(e),
            })
    print(json.dumps(summaries, default=str))

@scheduler_fn.on_schedule(schedule="20 1 * * *", timezone="America/Denver", secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"])
def sync_daily_entrata_units_availability_pricing_scheduled(event: scheduler_fn.ScheduledEvent) -> None:
    init_firebase()
    summaries = []
    for property_id in get_automation_property_ids():
        try:
            summaries.append(fetch_units_availability_and_pricing(property_id))
            time.sleep(1)
        except Exception as e:
            summaries.append({
                "property_id": property_id,
                "changed": False,
                "error": str(e),
            })
    print(json.dumps(summaries, default=str))

@scheduler_fn.on_schedule(schedule="30 2 * * *", timezone="America/Denver", secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"])
def sync_daily_entrata_lease_attribution_scheduled(event: scheduler_fn.ScheduledEvent) -> None:
    init_firebase()
    summaries = sync_lease_attribution(get_automation_property_ids())
    print(json.dumps(summaries, default=str))

@scheduler_fn.on_schedule(schedule="0 3 * * *", timezone="America/Denver", secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"])
def aggregate_daily_roi_scheduled(event: scheduler_fn.ScheduledEvent) -> None:
    init_firebase()
    summaries = aggregate_roi(get_automation_property_ids())
    print(json.dumps(summaries, default=str))

@scheduler_fn.on_schedule(schedule="0 2 * * *", timezone="America/Denver", secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"])
def start_daily_roi_pipeline_scheduled(event: scheduler_fn.ScheduledEvent) -> None:
    init_firebase()
    end_date = get_local_now().date()
    raw_start_date = end_date - datetime.timedelta(days=max(ROI_DAILY_RAW_LOOKBACK_DAYS - 1, 0))
    report_start_date = end_date - datetime.timedelta(days=max(ROI_DAILY_REPORT_LOOKBACK_DAYS - 1, 0))
    _, state = start_roi_pipeline_job(
        "roi_daily_pipeline",
        get_automation_property_ids(),
        raw_start_date=raw_start_date,
        raw_end_date=end_date,
        report_start_date=report_start_date,
        report_end_date=end_date,
        initiated_by="scheduler",
    )
    print(json.dumps({
        "message": "Started daily ROI pipeline",
        "state": state,
    }, default=str))

@scheduler_fn.on_schedule(schedule="*/5 * * * *", timezone="America/Denver", secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"])
def run_roi_pipeline_jobs_scheduled(event: scheduler_fn.ScheduledEvent) -> None:
    init_firebase()
    summaries = [
        process_roi_pipeline_job("roi_ytd_backfill"),
        process_roi_pipeline_job("roi_daily_pipeline"),
    ]
    print(json.dumps(summaries, default=str))

@scheduler_fn.on_schedule(schedule="* * * * *", timezone="America/Denver", secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"])
def run_background_entrata_backfill_scheduled(event: scheduler_fn.ScheduledEvent) -> None:
    init_firebase()
    print(process_background_backfill_batch())

@scheduler_fn.on_schedule(schedule="20 * * * *", timezone="America/Denver", secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"])
def run_daily_entrata_refresh_scheduled(event: scheduler_fn.ScheduledEvent) -> None:
    init_firebase()
    print(process_daily_refresh_batch())

@scheduler_fn.on_schedule(schedule="2-59/5 * * * *", timezone="America/Denver", secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"])
def run_entrata_retry_queue_scheduled(event: scheduler_fn.ScheduledEvent) -> None:
    init_firebase()
    print(process_retry_queue_batch())

@https_fn.on_request(secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"], timeout_sec=540, memory=512)
def trigger_entrata_backfill(req: https_fn.Request) -> https_fn.Response:
    init_firebase()
    days = int(req.args.get("days", 30))
    start_from = int(req.args.get("start_from", 0))
    property_ids = get_target_property_ids(req)
    success_count = 0
    error_count = 0
    
    for property_id in property_ids:
        for i in range(start_from, days):
            d = datetime.datetime.now() - datetime.timedelta(days=i)
            d_str = d.strftime("%m/%d/%Y")
            print(f"Backfilling property {property_id} for {d_str} (day {i+1}/{days})...")
            try:
                fetch_leads_for_date(property_id, d_str)
                fetch_events_for_date(property_id, d_str)
                fetch_leases_for_date(property_id, d_str)
                fetch_invoices_for_date(property_id, d_str)
                fetch_availability_for_date(property_id, d_str)
                success_count += 1
            except Exception as e:
                error_count += 1
                print(f"Error on property {property_id} for {d_str}: {str(e)}")
            # Rate-limit: wait 2 seconds between dates to avoid overwhelming Entrata
            time.sleep(2)
            
    return https_fn.Response(
        f"Backfill complete. Properties: {len(property_ids)}, Success: {success_count}, Errors: {error_count}, Days: {start_from}-{days}"
    )

@https_fn.on_request(secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"], timeout_sec=540, memory=512)
def trigger_background_backfill_batch(req: https_fn.Request) -> https_fn.Response:
    init_firebase()
    return https_fn.Response(process_background_backfill_batch())

@https_fn.on_request(secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"], timeout_sec=540, memory=512)
def trigger_daily_refresh_batch(req: https_fn.Request) -> https_fn.Response:
    init_firebase()
    return https_fn.Response(process_daily_refresh_batch())

@https_fn.on_request(secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"], timeout_sec=540, memory=512)
def trigger_retry_queue_batch(req: https_fn.Request) -> https_fn.Response:
    init_firebase()
    return https_fn.Response(process_retry_queue_batch())

@https_fn.on_request(secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"], timeout_sec=540, memory=512)
def sync_entrata_specials(req: https_fn.Request) -> https_fn.Response:
    init_firebase()

    try:
        property_ids = get_target_property_ids(req)
        if req.args.get("all_properties") == "1":
            property_ids = get_automation_property_ids()

        summaries = []
        for property_id in property_ids:
            try:
                summaries.append(fetch_specials(property_id))
            except Exception as e:
                summaries.append({
                    "property_id": property_id,
                    "changed": False,
                    "error": str(e),
                })
            time.sleep(1)

        body = json.dumps({
            "property_count": len(property_ids),
            "summaries": summaries,
        }, default=str)
        return https_fn.Response(body, mimetype="application/json")
    except Exception as e:
        return https_fn.Response(f"Internal Error: {str(e)}", status=500)

@https_fn.on_request(secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"], timeout_sec=540, memory=512)
def sync_entrata_units_availability_pricing(req: https_fn.Request) -> https_fn.Response:
    init_firebase()

    try:
        property_ids = get_target_property_ids(req)
        if req.args.get("all_properties") == "1":
            property_ids = get_automation_property_ids()

        end_date = parse_entrata_date(req.args.get("move_in_end_date")) or get_local_now().date()
        start_date = parse_entrata_date(req.args.get("move_in_start_date")) or datetime.date(end_date.year, 1, 1)

        summaries = []
        for property_id in property_ids:
            try:
                summaries.append(fetch_units_availability_and_pricing(property_id, start_date, end_date))
            except Exception as e:
                summaries.append({
                    "property_id": property_id,
                    "changed": False,
                    "error": str(e),
                })
            time.sleep(1)

        body = json.dumps({
            "property_count": len(property_ids),
            "move_in_start_date": serialize_date(start_date),
            "move_in_end_date": serialize_date(end_date),
            "summaries": summaries,
        }, default=str)
        return https_fn.Response(body, mimetype="application/json")
    except Exception as e:
        return https_fn.Response(f"Internal Error: {str(e)}", status=500)

@https_fn.on_request(secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"], timeout_sec=540, memory=1024)
def sync_entrata_lease_attribution(req: https_fn.Request) -> https_fn.Response:
    init_firebase()

    try:
        start_date, end_date = get_sync_window_from_request(req)
        lead_lookback_days = int(req.args.get("lead_lookback_days", LEASE_ATTRIBUTION_LEAD_LOOKBACK_DAYS))
        property_ids = get_target_property_ids(req)
        if req.args.get("all_properties") == "1":
            property_ids = get_automation_property_ids()

        summaries = sync_lease_attribution(
            property_ids,
            start_date=start_date,
            end_date=end_date,
            lead_lookback_days=lead_lookback_days,
        )
        body = json.dumps({
            "start_date": serialize_date(start_date),
            "end_date": serialize_date(end_date),
            "property_count": len(property_ids),
            "summaries": summaries,
        }, default=str)
        return https_fn.Response(body, mimetype="application/json")
    except Exception as e:
        return https_fn.Response(f"Internal Error: {str(e)}", status=500)

@https_fn.on_request(secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"], timeout_sec=540, memory=1024)
def aggregate_live_roi(req: https_fn.Request) -> https_fn.Response:
    init_firebase()

    try:
        start_date, end_date = get_sync_window_from_request(req)
        property_ids = get_target_property_ids(req)
        if req.args.get("all_properties") == "1":
            property_ids = get_automation_property_ids()

        summaries = aggregate_roi(
            property_ids,
            start_date=start_date,
            end_date=end_date,
        )
        body = json.dumps({
            "start_date": serialize_date(start_date),
            "end_date": serialize_date(end_date),
            "property_count": len(property_ids),
            "summaries": summaries,
        }, default=str)
        return https_fn.Response(body, mimetype="application/json")
    except Exception as e:
        return https_fn.Response(f"Internal Error: {str(e)}", status=500)

@https_fn.on_request(secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"], timeout_sec=540, memory=512)
def start_ytd_roi_backfill(req: https_fn.Request) -> https_fn.Response:
    init_firebase()

    try:
        property_ids = get_target_property_ids(req)
        if req.args.get("all_properties") == "1" or not req.args.get("property_id") and not req.args.get("property_ids"):
            property_ids = get_automation_property_ids()

        end_date = get_local_now().date()
        start_date = datetime.date(end_date.year, 1, 1)
        _, state = start_roi_pipeline_job(
            "roi_ytd_backfill",
            property_ids,
            raw_start_date=start_date,
            raw_end_date=end_date,
            report_start_date=start_date,
            report_end_date=end_date,
            initiated_by="manual",
        )
        first_batch_summary = process_roi_pipeline_job("roi_ytd_backfill")
        body = json.dumps({
            "message": "Started YTD ROI backfill",
            "initial_batch": first_batch_summary,
            "state": state,
        }, default=str)
        return https_fn.Response(body, mimetype="application/json")
    except Exception as e:
        return https_fn.Response(f"Internal Error: {str(e)}", status=500)

@https_fn.on_request(secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"])
def get_entrata_sync_state(req: https_fn.Request) -> https_fn.Response:
    init_firebase()
    background_ref, background_state = get_background_backfill_state()
    daily_ref, daily_state = get_daily_refresh_state()
    retry_jobs = []
    for snapshot in get_retry_jobs(25):
        data = snapshot.to_dict() or {}
        retry_jobs.append({
            "id": snapshot.id,
            "job_type": data.get("job_type"),
            "property_id": data.get("property_id"),
            "date_id": data.get("date_id"),
            "attempts": data.get("attempts"),
            "abandoned": data.get("abandoned", False),
            "last_error": data.get("last_error"),
        })
    body = json.dumps({
        "background_backfill": background_state,
        "daily_refresh": daily_state,
        "retry_queue_preview": retry_jobs,
    }, default=str)
    return https_fn.Response(body, mimetype="application/json")

@https_fn.on_request(secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"])
def get_roi_pipeline_status(req: https_fn.Request) -> https_fn.Response:
    init_firebase()
    body = json.dumps(get_roi_pipeline_status_payload(), default=str)
    return https_fn.Response(body, mimetype="application/json")

@https_fn.on_request(secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"])
def reset_entrata_sync_state(req: https_fn.Request) -> https_fn.Response:
    init_firebase()
    state_name = req.args.get("state")
    if state_name not in {"entrata_background_backfill", "entrata_daily_refresh"}:
        return https_fn.Response("Missing or invalid state parameter.", status=400)

    state_ref = get_state_doc(state_name)
    state_ref.delete()
    return https_fn.Response(f"Reset {state_name}.")

@https_fn.on_request(secrets=["ENTRATA_API_KEY", "ENTRATA_API_KEY_MULTIFAMILY"])
def fetch_entrata_lease_details(req: https_fn.Request) -> https_fn.Response:
    init_firebase()
    lease_id = req.args.get("leaseId")
    property_id = int(req.args.get("property_id", ENTRATA_PROPERTY_ID))
    if not lease_id:
        try:
            req_json = req.get_json(silent=True)
            if req_json:
                lease_id = req_json.get("leaseId")
                property_id = int(req_json.get("property_id", property_id))
        except Exception:
            pass
            
    if not lease_id:
        return https_fn.Response("Missing required parameter: leaseId", status=400)
        
    params = {
        "propertyId": property_id,
        "leaseId": lease_id,
        "includeAddOns": "1",
        "includeCharge": "1"
    }
    
    try:
        result = make_entrata_request("getLeaseDetails", "v1/leases", params, property_id)
        db = firestore.client()
        doc_data = {
            "lease_id": lease_id,
            "property_id": property_id,
            "details": result,
            "timestamp": firestore.SERVER_TIMESTAMP
        }
        db.collection("lease_details").document(str(lease_id)).set(doc_data)
        return https_fn.Response(f"Successfully fetched and stored lease details for leaseId: {lease_id}")
    except Exception as e:
        return https_fn.Response(f"Internal Error: {str(e)}", status=500)

@https_fn.on_request(timeout_sec=540, memory=512)
def get_ga4_dashboard_data(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return build_cors_response("")

    init_firebase()
    try:
        req_json = req.get_json(silent=True) or {}
        property_id = req.args.get("property_id") or req_json.get("property_id")
        ga4_property_id = req.args.get("ga4_property_id") or req_json.get("ga4_property_id")
        start_date_value = req.args.get("start_date") or req_json.get("start_date")
        end_date_value = req.args.get("end_date") or req_json.get("end_date")
        default_days = req.args.get("days") or req_json.get("days") or 90

        if not property_id:
            return build_cors_response(
                json.dumps({"error": "Missing required parameter: property_id"}),
                status=400,
                mimetype="application/json",
            )
        if not ga4_property_id:
            return build_cors_response(
                json.dumps({"error": "Missing required parameter: ga4_property_id"}),
                status=400,
                mimetype="application/json",
            )

        payload = fetch_ga4_dashboard_payload(
            property_id=property_id,
            ga4_property_id=ga4_property_id,
            start_date_value=start_date_value,
            end_date_value=end_date_value,
            default_days=default_days,
        )
        firestore.client().collection("properties").document(str(property_id)).collection("analytics").document("ga4_dashboard").set({
            **payload,
            "fetchedAt": firestore.SERVER_TIMESTAMP,
        }, merge=True)
        return build_cors_response(json.dumps(payload, default=str), mimetype="application/json")
    except ValueError as exc:
        return build_cors_response(
            json.dumps({"error": str(exc)}),
            status=400,
            mimetype="application/json",
        )
    except Exception as exc:
        print(f"GA4 dashboard fetch failed for property={req.args.get('property_id')}: {exc}")
        return build_cors_response(
            json.dumps({"error": str(exc)}),
            status=500,
            mimetype="application/json",
        )

@https_fn.on_request(timeout_sec=540, memory=512, secrets=["GOOGLE_ADS_CONFIG_JSON"])
def get_google_ads_dashboard_data(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return build_cors_response("")

    init_firebase()
    try:
        req_json = req.get_json(silent=True) or {}
        property_id = req.args.get("property_id") or req_json.get("property_id")
        google_ads_customer_id = (
            req.args.get("google_ads_customer_id")
            or req_json.get("google_ads_customer_id")
        )
        property_name = req.args.get("property_name") or req_json.get("property_name")
        start_date_value = req.args.get("start_date") or req_json.get("start_date")
        end_date_value = req.args.get("end_date") or req_json.get("end_date")
        default_days = req.args.get("days") or req_json.get("days") or 90

        if not property_id:
            return build_cors_response(
                json.dumps({"error": "Missing required parameter: property_id"}),
                status=400,
                mimetype="application/json",
            )
        if not google_ads_customer_id:
            return build_cors_response(
                json.dumps({"error": "Missing required parameter: google_ads_customer_id"}),
                status=400,
                mimetype="application/json",
            )

        payload = fetch_google_ads_dashboard_payload(
            property_id=property_id,
            google_ads_customer_id=google_ads_customer_id,
            property_name=property_name,
            start_date_value=start_date_value,
            end_date_value=end_date_value,
            default_days=default_days,
        )
        firestore.client().collection("properties").document(str(property_id)).collection("analytics").document("google_ads_dashboard").set({
            **payload,
            "fetchedAt": firestore.SERVER_TIMESTAMP,
        }, merge=True)
        return build_cors_response(json.dumps(payload, default=str), mimetype="application/json")
    except ValueError as exc:
        return build_cors_response(
            json.dumps({"error": str(exc)}),
            status=400,
            mimetype="application/json",
        )
    except Exception as exc:
        print(f"Google Ads dashboard fetch failed for property={req.args.get('property_id')}: {exc}")
        return build_cors_response(
            json.dumps({"error": str(exc)}),
            status=500,
            mimetype="application/json",
        )

@https_fn.on_request(timeout_sec=540, memory=512, secrets=["META_ACCESS_TOKEN"])
def get_meta_ads_dashboard_data(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return build_cors_response("")

    init_firebase()
    try:
        req_json = req.get_json(silent=True) or {}
        property_id = req.args.get("property_id") or req_json.get("property_id")
        meta_ads_account_id = (
            req.args.get("meta_ads_account_id")
            or req_json.get("meta_ads_account_id")
        )
        property_name = req.args.get("property_name") or req_json.get("property_name")
        match_terms = req.args.get("match_terms") or req_json.get("match_terms")
        campaign_ids = req.args.get("campaign_ids") or req_json.get("campaign_ids")
        attribution_mode = req.args.get("attribution_mode") or req_json.get("attribution_mode")
        start_date_value = req.args.get("start_date") or req_json.get("start_date")
        end_date_value = req.args.get("end_date") or req_json.get("end_date")
        default_days = req.args.get("days") or req_json.get("days") or 90
        force_refresh = (req.args.get("force_refresh") or req_json.get("force_refresh") or "0") == "1"

        if not property_id:
            return build_cors_response(
                json.dumps({"error": "Missing required parameter: property_id"}),
                status=400,
                mimetype="application/json",
            )
        if not meta_ads_account_id:
            return build_cors_response(
                json.dumps({"error": "Missing required parameter: meta_ads_account_id"}),
                status=400,
                mimetype="application/json",
            )

        window = resolve_reporting_window(start_date_value, end_date_value, default_days=default_days)
        cache_key = build_meta_ads_cache_key(
            meta_ads_account_id,
            window["current_start"].isoformat(),
            window["current_end"].isoformat(),
            resolve_meta_ads_attribution_config(attribution_mode)["mode"],
            campaign_ids,
            match_terms,
        )
        analytics_ref = firestore.client().collection("properties").document(str(property_id)).collection("analytics").document("meta_ads_dashboard")
        if not force_refresh:
            cached_snapshot = analytics_ref.get()
            if cached_snapshot.exists:
                cached_payload = cached_snapshot.to_dict() or {}
                fetched_at = cached_payload.get("fetchedAt")
                cache_max_minutes = int(os.environ.get("META_ADS_CACHE_MINUTES", "20"))
                now_utc = datetime.datetime.now(datetime.timezone.utc)
                fetched_at_dt = fetched_at
                if hasattr(fetched_at_dt, "to_datetime"):
                    fetched_at_dt = fetched_at_dt.to_datetime()
                if fetched_at_dt and getattr(fetched_at_dt, "tzinfo", None) is None:
                    fetched_at_dt = fetched_at_dt.replace(tzinfo=datetime.timezone.utc)
                cache_is_fresh = (
                    fetched_at_dt
                    and (now_utc - fetched_at_dt).total_seconds() <= cache_max_minutes * 60
                )
                if cached_payload.get("cacheKey") == cache_key and cache_is_fresh:
                    return build_cors_response(json.dumps(cached_payload, default=str), mimetype="application/json")

        payload = fetch_meta_ads_dashboard_payload(
            property_id=property_id,
            meta_ads_account_id=meta_ads_account_id,
            property_name=property_name,
            match_terms=match_terms,
            campaign_ids=campaign_ids,
            attribution_mode=attribution_mode,
            start_date_value=start_date_value,
            end_date_value=end_date_value,
            default_days=default_days,
        )
        analytics_ref.set({
            **payload,
            "cacheKey": cache_key,
            "fetchedAt": firestore.SERVER_TIMESTAMP,
        }, merge=True)
        return build_cors_response(json.dumps(payload, default=str), mimetype="application/json")
    except ValueError as exc:
        return build_cors_response(
            json.dumps({"error": str(exc)}),
            status=400,
            mimetype="application/json",
        )
    except Exception as exc:
        print(f"Meta Ads dashboard fetch failed for property={req.args.get('property_id')}: {exc}")
        return build_cors_response(
            json.dumps({"error": str(exc)}),
            status=500,
            mimetype="application/json",
        )

@https_fn.on_request(timeout_sec=540, memory=512, secrets=["OPINIION_USER_EMAIL", "OPINIION_USER_PASSWORD"])
def get_reputation_dashboard_data(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return build_cors_response("")

    init_firebase()
    try:
        req_json = req.get_json(silent=True) or {}
        property_id = req.args.get("property_id") or req_json.get("property_id")
        location_id = req.args.get("location_id") or req_json.get("location_id")
        location_name = req.args.get("location_name") or req_json.get("location_name")
        property_name = req.args.get("property_name") or req_json.get("property_name")
        property_city = req.args.get("property_city") or req_json.get("property_city")
        start_date_value = req.args.get("start_date") or req_json.get("start_date")
        end_date_value = req.args.get("end_date") or req_json.get("end_date")
        default_days = req.args.get("days") or req_json.get("days") or 90

        if not property_id:
            return build_cors_response(
                json.dumps({"error": "Missing required parameter: property_id"}),
                status=400,
                mimetype="application/json",
            )

        payload = fetch_opiniion_reputation_payload(
            property_id=property_id,
            location_id=location_id,
            location_name=location_name,
            property_name=property_name,
            property_city=property_city,
            start_date_value=start_date_value,
            end_date_value=end_date_value,
            default_days=default_days,
        )
        firestore.client().collection("properties").document(str(property_id)).collection("analytics").document("reputation_dashboard").set({
            **payload,
            "fetchedAt": firestore.SERVER_TIMESTAMP,
        }, merge=True)
        return build_cors_response(json.dumps(payload, default=str), mimetype="application/json")
    except ValueError as exc:
        return build_cors_response(
            json.dumps({"error": str(exc)}),
            status=400,
            mimetype="application/json",
        )
    except Exception as exc:
        print(f"Reputation dashboard fetch failed for property={req.args.get('property_id')}: {exc}")
        return build_cors_response(
            json.dumps({"error": str(exc)}),
            status=500,
            mimetype="application/json",
        )

@scheduler_fn.on_schedule(schedule="0 3 * * 1", timezone="America/Denver", secrets=["ENTRATA_API_KEY"])
def weekly_site_audit_scheduled(event: scheduler_fn.ScheduledEvent) -> None:
    init_firebase()
    # Import the local audit module
    import site_audit
    report = site_audit.perform_site_audit()
    site_audit.save_audit(report)

# @scheduler_fn.on_schedule(schedule="0 4 * * *", timezone="America/Denver", secrets=["GA4_PROPERTY_ID", "GOOGLE_SERVICE_ACCOUNT_KEY"])
# def fetch_daily_ga4_metrics_scheduled(event: scheduler_fn.ScheduledEvent) -> None:
#     init_firebase()
#     from google.analytics.data_v1beta import BetaAnalyticsDataClient
#     ... (truncated)

# @scheduler_fn.on_schedule(schedule="0 4 * * *", timezone="America/Denver", secrets=["GOOGLE_ADS_CUSTOMER_ID", "GOOGLE_ADS_CONFIG_JSON"])
# def fetch_daily_google_ads_metrics_scheduled(event: scheduler_fn.ScheduledEvent) -> None:
#     init_firebase()
#     from google.ads.googleads.client import GoogleAdsClient
#     ... (truncated)
