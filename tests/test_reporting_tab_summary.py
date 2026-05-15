from pathlib import Path
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "functions"))

import render_supabase_analytics as analytics  # noqa: E402
import render_supabase_heatmaps as heatmaps  # noqa: E402
import render_supabase_reporting as reporting  # noqa: E402


class ReportingTabSummaryTests(unittest.TestCase):
    def test_summary_returns_compact_analytics_and_report_cards(self):
        def cached_summary(property_id, analytics_kind):
            self.assertEqual(property_id, "10")
            if analytics_kind == "ga4":
                return {
                    "Acquisition": {
                        "totals": {"current": {"sessions": 123, "newUsers": 45, "engagementRate": 0.61}},
                        "channels": [{"channel": "Organic Search", "sessions": 70}],
                    },
                    "Conversion": {"totals": {"currentEventCount": 12}},
                }
            if analytics_kind == "google_ads":
                return {
                    "Overview": {"current": {"clicks": 50, "cost": 321.5, "conversions": 6}},
                    "Campaigns": [{"name": "Brand", "clicks": 20}],
                }
            if analytics_kind == "meta_ads":
                return {
                    "Overview": {"current": {"clicks": 25, "spend": 99.5, "results": 4, "resultLabel": "Leads"}},
                    "Campaigns": [{"name": "Traffic", "clicks": 12}],
                }
            if analytics_kind == "local_falcon":
                return {"Overview": {"averageRankPosition": 4.2, "shareOfLocalVoice": 0.18}}
            raise AssertionError(f"Unexpected analytics kind {analytics_kind}")

        with mock.patch.object(analytics, "get_cached_analytics_summary", side_effect=cached_summary):
            payload = reporting.get_property_reporting_tab_summary(
                "10",
                "2026-05-01",
                "2026-05-14",
                sections=["analytics", "reports"],
            )

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["analytics"]["ga4"]["overview"]["sessions"], 123)
        self.assertEqual(payload["analytics"]["googleAds"]["overview"]["cost"], 321.5)
        self.assertIsNone(payload["reputation"])
        cards = {card["id"]: card for card in payload["reports"]["dashboardCards"]}
        self.assertEqual(cards["ga4"]["metrics"][0]["value"], 123)
        self.assertEqual(cards["google-ads"]["metrics"][1]["value"], 321.5)
        self.assertEqual(cards["local-falcon"]["metrics"][0]["value"], 4.2)

    def test_summary_hydrates_heatmap_and_audit_sections(self):
        with mock.patch.object(heatmaps, "get_heatmap_pages_summary", return_value={
            "status": "ok",
            "pages": [{"path": "/floorplans", "events": 20}],
        }) as pages_mock, mock.patch.object(heatmaps, "get_heatmap_summary", return_value={
            "status": "ok",
            "totals": {"sessions": 9, "clicks": 3},
            "topTargets": [{"label": "Apply", "count": 2}],
        }) as summary_mock, mock.patch.object(heatmaps, "get_heatmap_tracker_health_summary", return_value={
            "status": "ok",
            "health": {"status": "healthy"},
        }), mock.patch.object(heatmaps, "get_site_audit_pages_summary", return_value={
            "status": "ok",
            "pages": [{"path": "/floorplans"}],
        }), mock.patch.object(heatmaps, "get_site_audit_summary", return_value={
            "status": "ok",
            "audit": {"overallScore": 88, "issues": ["Update pricing"], "recommendations": ["Verify specials"]},
        }):
            payload = reporting.get_property_reporting_tab_summary(
                "10",
                "2026-05-01",
                "2026-05-14",
                site_key="site-1",
                device_type="desktop",
                sections="heatmap,audit,reports",
                access_token="token",
            )

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["heatmap"]["selectedPath"], "/floorplans")
        self.assertEqual(payload["heatmap"]["overview"]["totals"]["sessions"], 9)
        self.assertEqual(payload["audit"]["overview"]["issueCount"], 1)
        summary_kwargs = summary_mock.call_args.kwargs
        self.assertEqual(summary_kwargs["path"], "/floorplans")
        self.assertEqual(summary_kwargs["device_type"], "desktop")
        pages_kwargs = pages_mock.call_args.kwargs
        self.assertEqual(pages_kwargs["site_key"], "site-1")
        self.assertEqual(pages_kwargs["access_token"], "token")

    def test_summary_keeps_partial_errors_inside_sections(self):
        with mock.patch.object(analytics, "get_cached_analytics_summary", return_value={
            "status": "error",
            "error": "No cached GA4 snapshot found.",
        }):
            payload = reporting.get_property_reporting_tab_summary(
                "10",
                "2026-05-01",
                "2026-05-14",
                sections="ga4",
            )

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["analytics"]["ga4"]["status"], "error")
        self.assertIn("No cached GA4", payload["analytics"]["ga4"]["error"])
        self.assertGreaterEqual(len(payload["errors"]), 1)


class RedListSummaryTests(unittest.TestCase):
    def test_reporting_overview_counts_only_lead_event_api_guest_cards_in_range(self):
        def fake_fetch(table_name, query_params, *, headers=None):
            if table_name == "property_daily_snapshots":
                return [{"id": "10_2026-05-14", "property_id": "10", "activity_date": "2026-05-14"}]
            if table_name == "property_leads":
                return [
                    {
                        "property_id": "10",
                        "activity_date": "2026-05-10",
                        "raw_data": {
                            "_sourceApi": "getLeadEvents",
                            "_sourceEventType": "online_guest_card",
                            "leadEventId": "event-in-range",
                            "typeId": "10",
                            "eventReason": "Online Guest Card",
                            "eventDate": "05/10/2026",
                            "email": "sam@example.com",
                        },
                    },
                    {
                        "property_id": "10",
                        "activity_date": "2026-05-10",
                        "raw_data": {
                            "_sourceApi": "getLeadEvents",
                            "_sourceEventType": "online_guest_card",
                            "leadEventId": "event-duplicate",
                            "leadId": "event-duplicate",
                            "typeId": "10",
                            "eventReason": "Online Guest Card",
                            "eventDate": "05/10/2026",
                            "email": "SAM@example.com",
                        },
                    },
                    {
                        "property_id": "10",
                        "activity_date": "2026-05-11",
                        "raw_data": {
                            "leadId": "legacy-current-lead",
                            "createdDate": "05/11/2026",
                        },
                    },
                    {
                        "property_id": "10",
                        "activity_date": "2026-05-12",
                        "raw_data": {
                            "_sourceApi": "getLeadEvents",
                            "_sourceEventType": "online_guest_card",
                            "leadEventId": "event-outside-range",
                            "typeId": "10",
                            "eventReason": "Online Guest Card",
                            "eventDate": "04/30/2026",
                        },
                    },
                    {
                        "property_id": "10",
                        "activity_date": "2026-05-12",
                        "raw_data": {
                            "_sourceApi": "getLeadEvents",
                            "_sourceEventType": "online_guest_card",
                            "leadEventId": "old-lead-with-current-activity",
                            "typeId": "10",
                            "eventReason": "Online Guest Card",
                            "eventDate": "05/12/2026",
                            "createdDate": "04/30/2026",
                            "email": "old-lead@example.com",
                        },
                    },
                    {
                        "property_id": "10",
                        "activity_date": "2026-05-13",
                        "raw_data": {
                            "_sourceApi": "getLeadEvents",
                            "eventId": "application-event",
                            "typeId": "12",
                            "eventReason": "Application Status: Completed",
                            "eventDate": "05/13/2026",
                        },
                    },
                ]
            if table_name == "property_availability_snapshots":
                return [{"property_id": "10", "floorplans": [], "units": [], "raw_result": {}}]
            return []

        with mock.patch.object(reporting, "_supabase_anon_headers", return_value={}), \
             mock.patch.object(reporting, "_fetch_json", side_effect=fake_fetch), \
             mock.patch.object(reporting, "get_property_red_list_summary", return_value={}):
            payload = reporting.get_property_reporting_overview_payload("10", "2026-05-01", "2026-05-14", access_token="token")

        self.assertEqual(payload["counts"]["lead_items"], 1)
        self.assertEqual(payload["lead_items"][0]["leadEventId"], "event-in-range")
        self.assertEqual(payload["lead_items"][0]["_date"], "2026-05-10")

    def test_red_list_summary_uses_latest_supabase_snapshot_and_last_30_days(self):
        queries = []

        def fake_fetch(table_name, query_params, *, headers=None):
            queries.append((table_name, dict(query_params)))
            if table_name == "property_daily_snapshots":
                return [{"property_id": "10", "activity_date": "2026-05-10"}]
            if table_name == "property_leads":
                return [
                    {"property_id": "10", "activity_date": "2026-04-11", "raw_data": {"_sourceApi": "getLeadEvents", "_sourceEventType": "online_guest_card", "leadEventId": "a", "typeId": "10", "eventDate": "04/11/2026"}},
                    {"property_id": "10", "activity_date": "2026-05-01", "raw_data": {"_sourceApi": "getLeadEvents", "_sourceEventType": "online_guest_card", "leadEventId": "b", "typeId": "10", "eventDate": "05/01/2026"}},
                    {"property_id": "10", "activity_date": "2026-05-10", "raw_data": {"_sourceApi": "getLeadEvents", "_sourceEventType": "online_guest_card", "leadEventId": "c", "typeId": "10", "eventDate": "05/10/2026"}},
                    {"property_id": "10", "activity_date": "2026-05-10", "raw_data": {"leadId": "legacy"}},
                ]
            if table_name == "property_availability_snapshots":
                return [{"property_id": "10", "raw_result": {"bed_count": 100, "unit_count": 100}}]
            if table_name == "property_leases":
                return []
            return []

        with mock.patch.object(reporting, "_supabase_anon_headers", return_value={}), mock.patch.object(reporting, "_fetch_json", side_effect=fake_fetch):
            payload = reporting.get_property_red_list_summary("10", "2026-05-14", access_token="token")

        self.assertEqual(payload["as_of_date"], "2026-05-10")
        self.assertEqual(payload["activity_start_date"], "2026-04-11")
        self.assertEqual(payload["activity_end_date"], "2026-05-10")
        self.assertEqual(payload["activity_window_days"], 30)
        self.assertEqual(payload["lead_count"], 3)
        lead_query = next(query for table, query in queries if table == "property_leads")
        self.assertEqual(lead_query["activity_date"], "lte.2026-05-10")


if __name__ == "__main__":
    unittest.main()
