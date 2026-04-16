import datetime
import json
import os
from urllib.request import Request, urlopen

import requests
from bs4 import BeautifulSoup

from render_supabase_sync_state import _table_query_url
from render_supabase_validation import _supabase_headers

SITE_AUDIT_BASE_URL = os.environ.get("SITE_AUDIT_BASE_URL", "https://livemontaireslc.com")

BASE_URL = SITE_AUDIT_BASE_URL
INTERNAL_PAGES = [
    "/",
    "/amenities/",
    "/floor-plans/",
    "/gallery/",
    "/neighborhood/",
    "/faqs/",
    "/blog/",
    "/contact/",
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}


def perform_site_audit():
    audit_report = {
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "site": BASE_URL,
        "pages_audited": [],
        "broken_links": [],
        "missing_meta": [],
        "headline_optimizations": [],
    }

    for path in INTERNAL_PAGES:
        url = BASE_URL + path
        try:
            response = requests.get(url, headers=HEADERS, timeout=15)
            page_data = {
                "url": url,
                "status_code": response.status_code,
                "has_meta_description": False,
                "h1": "",
                "title": "",
            }

            if response.status_code == 200:
                soup = BeautifulSoup(response.text, "html.parser")

                meta_desc = soup.find("meta", attrs={"name": "description"}) or soup.find(
                    "meta",
                    attrs={"property": "og:description"},
                )
                if meta_desc and meta_desc.get("content"):
                    page_data["has_meta_description"] = True
                else:
                    audit_report["missing_meta"].append(url)

                h1 = soup.find("h1")
                page_data["h1"] = h1.text.strip() if h1 else "Missing H1"
                title = soup.find("title")
                page_data["title"] = title.text.strip() if title and title.text else ""

                links = soup.find_all("a", href=True)
                for link in links:
                    href = link["href"]
                    if href.startswith("/") or BASE_URL in href:
                        if not href or href == "#":
                            audit_report["broken_links"].append(
                                {"source": url, "link": href, "reason": "Empty or anchor only"}
                            )
            else:
                audit_report["broken_links"].append(
                    {"source": "Navigation", "link": url, "reason": f"Status {response.status_code}"}
                )

            audit_report["pages_audited"].append(page_data)
        except Exception as e:
            audit_report["broken_links"].append({"source": "Crawl", "link": url, "reason": str(e)})

    return audit_report


def save_audit(report):
    audited_at = report.get("timestamp") or datetime.datetime.now(datetime.timezone.utc).isoformat()
    payload = {
        "site": report.get("site") or BASE_URL,
        "audited_at": audited_at,
        "pages_audited": report.get("pages_audited") or [],
        "broken_links": report.get("broken_links") or [],
        "missing_meta": report.get("missing_meta") or [],
        "headline_optimizations": report.get("headline_optimizations") or [],
        "raw_data": report,
        "firestore_path": f"site_audits/{audited_at}",
    }
    request = Request(
        _table_query_url("site_audits", []),
        headers={**_supabase_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
    )
    with urlopen(request, timeout=60) as response:
        body = response.read().decode("utf-8")
    print(f"Audit completed and saved to Supabase for {BASE_URL}")
    return json.loads(body)[0] if body else payload


if __name__ == "__main__":
    report = perform_site_audit()
    save_audit(report)
