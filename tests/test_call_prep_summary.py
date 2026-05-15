import datetime as dt
from pathlib import Path
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "functions"))

import render_supabase_reporting as reporting  # noqa: E402


class CallPrepSummaryTests(unittest.TestCase):
    def test_portfolio_average_excludes_unloaded_and_no_data_properties(self):
        current_end = dt.date(2026, 5, 14)
        current_start = current_end - dt.timedelta(days=6)
        payload = {
            "loaded_property_ids": ["2", "3"],
            "lead_items": [
                {"_propertyId": "2", "_date": "2026-05-14", "leadId": "lead-1"},
                {"_propertyId": "2", "_date": "2026-05-13", "leadId": "lead-2"},
            ],
            "event_items": [
                {
                    "_propertyId": "2",
                    "_date": "2026-05-14",
                    "typeId": 12,
                    "eventReason": "Application Status: Completed",
                    "applicationId": "app-1",
                }
            ],
            "lease_items": [],
            "invoice_items": [],
        }

        average = reporting._average_call_prep_metrics(
            payload,
            current_start,
            current_end,
            ["1", "2", "3", "4"],
            "1",
        )

        self.assertEqual(average["propertiesLoaded"], 2)
        self.assertEqual(average["portfolioSampleSize"], 1)
        self.assertEqual(average["metricSampleSizes"]["leads"], 1)
        self.assertEqual(average["leads"], 2)
        self.assertIn("3", average["noDataPropertyIds"])
        self.assertIn("4", average["excludedPropertyIds"])

    def test_application_and_lease_fallback_parsing(self):
        current_start = dt.date(2026, 5, 1)
        current_end = dt.date(2026, 5, 14)
        payload = {
            "lead_items": [
                {
                    "_propertyId": "10",
                    "_date": "2026-05-03",
                    "leadId": "lead-application",
                    "applicationId": "app-fallback",
                    "leadSource": "Website",
                },
                {
                    "_propertyId": "10",
                    "_date": "2026-05-04",
                    "leadId": "lead-event",
                    "leadSource": "Google",
                },
            ],
            "event_items": [
                {
                    "_propertyId": "10",
                    "_date": "2026-05-04",
                    "eventType": {"typeId": "12", "eventReason": "Application Status: Completed"},
                    "applicationId": "app-event",
                }
            ],
            "lease_items": [
                {
                    "_propertyId": "10",
                    "id": "lease-1",
                    "raw_data": {"leaseApprovedDate": "2026-05-05", "leaseId": "lease-1"},
                }
            ],
            "invoice_items": [],
        }

        metrics = reporting._build_call_prep_metrics(payload, current_start, current_end, "10")

        self.assertEqual(metrics["leads"], 2)
        self.assertEqual(metrics["applications"], 1)
        self.assertEqual(metrics["leases"], 1)
        self.assertEqual(metrics["leadToAppRate"], 0.5)
        self.assertEqual(metrics["leadToLeaseRate"], 0.5)

    def test_application_identifier_fallback_when_completed_events_are_missing(self):
        current_start = dt.date(2026, 5, 1)
        current_end = dt.date(2026, 5, 14)
        payload = {
            "lead_items": [
                {
                    "_propertyId": "10",
                    "_date": "2026-05-03",
                    "leadId": "lead-application",
                    "applicationId": "app-fallback",
                    "leadSource": "Website",
                }
            ],
            "event_items": [],
            "lease_items": [],
            "invoice_items": [],
        }

        metrics = reporting._build_call_prep_metrics(payload, current_start, current_end, "10")

        self.assertEqual(metrics["applications"], 1)
        self.assertTrue(metrics["dataQuality"]["applicationFallbackUsed"])

    def test_call_prep_metrics_use_lead_statuses(self):
        current_start = dt.date(2026, 5, 1)
        current_end = dt.date(2026, 5, 14)
        payload = {
            "lead_items": [
                {
                    "_propertyId": "10",
                    "_date": "2026-05-02",
                    "leadId": "lead-1",
                    "status": "New Lead",
                },
                {
                    "_propertyId": "10",
                    "_date": "2026-05-03",
                    "leadId": "lead-2",
                    "status": "Application Completed",
                },
                {
                    "_propertyId": "10",
                    "_date": "2026-05-04",
                    "leadId": "lead-3",
                    "status": "Lease Approved",
                },
            ],
            "event_items": [],
            "lease_items": [],
            "invoice_items": [],
        }

        metrics = reporting._build_call_prep_metrics(payload, current_start, current_end, "10")

        self.assertEqual(metrics["leads"], 3)
        self.assertEqual(metrics["applications"], 1)
        self.assertEqual(metrics["leases"], 1)
        self.assertEqual(metrics["dataQuality"]["applicationStatusRows"], 1)
        self.assertEqual(metrics["dataQuality"]["leaseStatusRows"], 1)

    def test_lead_created_date_accepts_entrata_created_date_fields(self):
        row = {
            "activity_date": "2026-05-14",
            "raw_data": {"createdDate": "05/03/2026"},
        }

        self.assertEqual(reporting._lead_created_date(row), dt.date(2026, 5, 3))

    def test_lead_created_date_prefers_inquiry_fields_over_event_activity(self):
        row = {
            "activity_date": "2026-05-14",
            "raw_data": {
                "_sourceApi": "getLeadEvents",
                "_sourceEventType": "online_guest_card",
                "eventDate": "05/14/2026",
                "firstContactDate": "05/02/2026",
            },
        }

        self.assertEqual(reporting._lead_created_date(row), dt.date(2026, 5, 2))

    def test_invoice_helpers_accept_normalized_supabase_columns(self):
        invoice = {
            "amount": 3100,
            "post_month": "05/2026",
            "post_date": "2026-05-01",
            "gl_account_number": "5300-0030",
            "gl_account_name": "Internet Advertising",
            "vendor_name": "Search Partner",
        }

        self.assertEqual(reporting._invoice_amount(invoice), 3100)
        self.assertEqual(reporting._invoice_effective_date(invoice), dt.date(2026, 5, 1))
        self.assertEqual(
            reporting._invoice_allocation_month(invoice),
            (dt.date(2026, 5, 1), dt.date(2026, 5, 31)),
        )
        self.assertTrue(reporting._invoice_has_classification(
            invoice,
            reporting._ALL_MARKETING_GL_CODES,
            reporting._ALL_MARKETING_DESCRIPTIONS,
        ))

    def test_compact_invoice_payload_preserves_normalized_supabase_columns(self):
        row = {
            "property_snapshot_id": "snap-1",
            "property_id": "10",
            "activity_date": "2026-05-14",
            "amount": 3100,
            "post_month": "05/2026",
            "post_date": "2026-05-01",
            "gl_account_number": "5300-0030",
            "gl_account_name": "Internet Advertising",
            "vendor_name": "Search Partner",
            "raw_data": {},
        }

        compact = reporting._compact_invoice_payload(row)

        self.assertEqual(compact["amount"], 3100)
        self.assertEqual(compact["post_month"], "05/2026")
        self.assertEqual(compact["post_date"], "2026-05-01")
        self.assertEqual(compact["gl_account_number"], "5300-0030")
        self.assertEqual(compact["vendorName"], "Search Partner")

    def test_lead_identity_dedupes_multiple_guest_card_events(self):
        rows = [
            {
                "_propertyId": "10",
                "leadEventId": "event-1",
                "leadId": "lead-1",
            },
            {
                "_propertyId": "10",
                "leadEventId": "event-2",
                "leadId": "lead-1",
            },
        ]

        self.assertEqual(reporting._unique_lead_count(rows), 1)

    def test_lead_identity_ignores_event_id_disguised_as_lead_id(self):
        rows = [
            {
                "_propertyId": "10",
                "leadEventId": "event-1",
                "leadId": "event-1",
                "email": "sam@example.com",
            },
            {
                "_propertyId": "10",
                "leadEventId": "event-2",
                "leadId": "event-2",
                "email": "SAM@example.com",
            },
        ]

        self.assertEqual(reporting._unique_lead_count(rows), 1)

    def test_lead_identity_prefers_prospect_key_over_event_ids(self):
        rows = [
            {
                "_propertyId": "10",
                "leadEventId": "event-1",
                "leadId": "event-1",
                "prospectKey": "hash:same-prospect",
            },
            {
                "_propertyId": "10",
                "leadEventId": "event-2",
                "leadId": "event-2",
                "prospectKey": "hash:same-prospect",
            },
        ]

        self.assertEqual(reporting._unique_lead_count(rows), 1)

    def test_multi_property_call_prep_summary_batches_table_reads(self):
        fetch_results = [[], [], [], []]

        with mock.patch.object(reporting, "_supabase_anon_headers", return_value={"Authorization": "Bearer test"}), \
             mock.patch.object(reporting, "_fetch_json", side_effect=fetch_results) as fetch_json:
            payload = reporting.get_multi_property_call_prep_summary(
                ["10", "20"],
                "2026-01-15",
                "2026-05-14",
                access_token="token",
            )

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["properties_loaded"], 2)
        self.assertEqual(fetch_json.call_count, 4)
        for call in fetch_json.call_args_list:
            params = call.args[1]
            self.assertIn(("property_id", "in.(10,20)"), params)

    def test_call_prep_counts_only_get_lead_events_rows(self):
        rows_by_key = {
            "leads": [
                {
                    "property_snapshot_id": "snap-1",
                    "property_id": "10",
                    "activity_date": "2026-05-14",
                    "raw_data": {"leadId": "lead-1", "leadSource": "Website"},
                },
                {
                    "property_snapshot_id": "snap-1",
                    "property_id": "10",
                    "activity_date": "2026-05-14",
                    "raw_data": {
                        "_sourceApi": "getLeadEvents",
                        "_sourceEventType": "online_guest_card",
                        "leadEventId": "event-1",
                        "leadId": "event-1",
                        "leadSource": "Website",
                        "eventDate": "05/14/2026",
                        "leadCreatedDate": "05/14/2026",
                        "email": "sam@example.com",
                    },
                },
                {
                    "property_snapshot_id": "snap-1",
                    "property_id": "10",
                    "activity_date": "2026-05-14",
                    "raw_data": {
                        "_sourceApi": "getLeadEvents",
                        "_sourceEventType": "online_guest_card",
                        "leadEventId": "event-2",
                        "leadId": "event-2",
                        "leadSource": "Website",
                        "eventDate": "05/14/2026",
                        "leadCreatedDate": "05/14/2026",
                        "email": "SAM@example.com",
                    },
                },
            ],
            "events": [],
            "leases": [],
            "invoices": [],
        }

        with mock.patch.object(reporting, "_supabase_anon_headers", return_value={"Authorization": "Bearer test"}), \
             mock.patch.object(reporting, "_fetch_call_prep_table_set", return_value=(rows_by_key, {})):
            payload = reporting.get_multi_property_call_prep_summary(
                ["10"],
                "2026-05-01",
                "2026-05-14",
                access_token="token",
            )

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["counts"]["lead_items"], 1)
        self.assertEqual(payload["property_row_counts"]["10"]["lead_items"], 1)
        self.assertEqual(payload["lead_items"][0]["leadEventId"], "event-1")

    def test_google_ads_cached_snapshot_is_derived_by_window(self):
        payload = {
            "Ads": {
                "dailyPerformance": [
                    {"date": "20260514", "impressions": 100, "clicks": 10, "conversions": 2, "cost": 50},
                    {"date": "20260507", "impressions": 50, "clicks": 5, "conversions": 1, "cost": 20},
                ]
            }
        }

        window = reporting._derive_google_ads_call_prep_window(
            payload,
            dt.date(2026, 5, 8),
            dt.date(2026, 5, 14),
            dt.date(2026, 5, 1),
            dt.date(2026, 5, 7),
        )

        self.assertEqual(window["Overview"]["current"]["clicks"], 10)
        self.assertEqual(window["Overview"]["previous"]["clicks"], 5)
        self.assertEqual(window["Overview"]["delta"]["clicks"], 1)
        self.assertEqual(window["callPrepWindow"]["mode"], "derived_from_cached_daily_rows")
        self.assertEqual(len(window["Ads"]["dailyPerformance"]), 1)

    def test_ga4_cached_snapshot_is_derived_by_window(self):
        payload = {
            "Acquisition": {"totals": {"current": {"engagementRate": 0.4}, "previous": {"engagementRate": 0.3}}},
            "Conversion": {
                "totals": {"currentEventCount": 999},
                "conversionsByDay": [
                    {"date": "2026-05-14", "sessions": 100, "keyEvents": 7},
                    {"date": "2026-05-07", "sessions": 50, "keyEvents": 2},
                ],
            },
        }

        window = reporting._derive_ga4_call_prep_window(
            payload,
            dt.date(2026, 5, 8),
            dt.date(2026, 5, 14),
            dt.date(2026, 5, 1),
            dt.date(2026, 5, 7),
        )

        self.assertEqual(window["Acquisition"]["totals"]["current"]["sessions"], 100)
        self.assertEqual(window["Acquisition"]["totals"]["previous"]["sessions"], 50)
        self.assertEqual(window["Conversion"]["totals"]["currentEventCount"], 7)
        self.assertEqual(window["Conversion"]["totals"]["previousEventCount"], 2)
        self.assertEqual(window["callPrepWindow"]["mode"], "derived_from_cached_daily_rows")
        self.assertEqual(len(window["Conversion"]["conversionsByDay"]), 1)


if __name__ == "__main__":
    unittest.main()
