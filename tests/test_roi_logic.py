from pathlib import Path
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "functions"))

try:
    import main  # noqa: E402
except ModuleNotFoundError as error:
    if error.name in {"firebase_functions", "firebase_admin", "google"}:
        raise unittest.SkipTest("Firebase Functions runtime is not installed; skipping legacy main.py integration tests.") from error
    raise


def make_lead_record(document_id, parent_date, data, **overrides):
    contact_fields = main.extract_lead_contact_fields(data)
    return {
        "document_path": f"property_data/x/leads/{document_id}",
        "document_id": document_id,
        "parent_id": "x",
        "parent_date": parent_date,
        "data": data,
        "identifiers": main.get_collection_identifiers(data, main.LEAD_IDENTIFIER_KEYS),
        "application_id": data.get("applicationId"),
        "lease_id": data.get("leaseId"),
        **contact_fields,
        **overrides,
    }


class RoiLogicTests(unittest.TestCase):
    def test_roi_pipeline_status_payload_summarizes_progress(self):
        ytd_state = {
            "active": True,
            "completed": False,
            "phase": "attribution",
            "initiated_by": "manual",
            "raw_start_date": "2026-01-01",
            "raw_end_date": "2026-03-31",
            "report_start_date": "2026-01-01",
            "report_end_date": "2026-03-31",
            "raw_day_index": 12,
            "attribution_property_index": 7,
            "aggregate_property_index": 3,
            "property_ids": [1, 2, 3, 4, 5, 6, 7, 8],
            "last_summary": "attribution processed=4",
        }
        daily_state = {
            "active": False,
            "completed": True,
            "phase": "done",
            "property_ids": [10, 20],
        }

        with mock.patch.object(main, "get_roi_pipeline_state", side_effect=[(None, ytd_state), (None, daily_state)]):
            payload = main.get_roi_pipeline_status_payload()

        self.assertEqual(payload["roi_ytd_backfill"]["phase"], "attribution")
        self.assertEqual(payload["roi_ytd_backfill"]["progress"]["raw_days_processed"], 12)
        self.assertEqual(payload["roi_ytd_backfill"]["progress"]["attribution_properties_processed"], 7)
        self.assertEqual(payload["roi_ytd_backfill"]["property_count"], 8)
        self.assertTrue(payload["roi_daily_refresh"]["completed"])

    def test_guest_card_detection(self):
        self.assertTrue(main.is_guest_card_record({"source": "Guest Card", "status": "Open"}))
        self.assertFalse(main.is_guest_card_record({"source": "Google Ads", "status": "Open"}))

    def test_match_priority_prefers_application_id_over_email(self):
        lease = {
            "application_id": "app-123",
            "lease_id": "lease-999",
            "attribution_event_date": "2026-03-10",
            "normalized_email": "resident@example.com",
            "normalized_phone": "8015551234",
            "normalized_full_name": "sam resident",
        }
        app_match = make_lead_record(
            "lead-app",
            "2026-03-01",
            {"applicationId": "app-123", "leadSource": "Google Ads"},
        )
        email_match = make_lead_record(
            "lead-email",
            "2026-03-09",
            {"email": "resident@example.com", "leadSource": "Zillow"},
        )
        lead_index = {
            "lead_docs_by_path": {
                app_match["document_path"]: app_match,
                email_match["document_path"]: email_match,
            }
        }

        result = main.correlate_lease_to_lead(lease, lead_index)

        self.assertEqual(result["match_type"], "application_id")
        self.assertEqual(result["lead_document_id"], "lead-app")

    def test_match_falls_back_to_phone_then_name_date(self):
        lease = {
            "application_id": None,
            "lease_id": None,
            "attribution_event_date": "2026-03-10",
            "normalized_email": None,
            "normalized_phone": "8015551234",
            "normalized_full_name": "alex renter",
        }
        phone_match = make_lead_record(
            "lead-phone",
            "2026-03-07",
            {"phone": "(801) 555-1234", "leadSource": "Meta Ads"},
        )
        name_match = make_lead_record(
            "lead-name",
            "2026-03-09",
            {"fullName": "Alex Renter", "leadSource": "Referral"},
        )
        lead_index = {
            "lead_docs_by_path": {
                phone_match["document_path"]: phone_match,
                name_match["document_path"]: name_match,
            }
        }

        result = main.correlate_lease_to_lead(lease, lead_index)
        self.assertEqual(result["match_type"], "phone")
        self.assertEqual(result["lead_document_id"], "lead-phone")

        lease_without_phone = {**lease, "normalized_phone": None}
        result = main.correlate_lease_to_lead(lease_without_phone, lead_index)
        self.assertEqual(result["match_type"], "name_date")
        self.assertEqual(result["lead_document_id"], "lead-name")

    def test_name_date_match_requires_close_proximity(self):
        lease = {
            "application_id": None,
            "lease_id": None,
            "attribution_event_date": "2026-03-31",
            "normalized_email": None,
            "normalized_phone": None,
            "normalized_full_name": "jamie renter",
        }
        distant_name = make_lead_record(
            "lead-name",
            "2026-02-01",
            {"fullName": "Jamie Renter", "leadSource": "Google Ads"},
        )
        lead_index = {"lead_docs_by_path": {distant_name["document_path"]: distant_name}}

        result = main.correlate_lease_to_lead(lease, lead_index)
        self.assertIsNone(result)

    def test_roi_bucket_counts_only_matched_leases_toward_revenue(self):
        buckets = main.build_daily_roi_buckets(100076494, main.parse_iso_date("2026-03-01"), main.parse_iso_date("2026-03-01"))
        matched_lease = {
            "attribution_event_date": "2026-03-01",
            "gross_lease_value": 36000,
            "net_effective_rent": 2800,
            "lease_term_months": 12,
            "concession_total": 2400,
            "attribution_status": "matched",
            "lead_attribution": {"source_key": "google_ads", "source_label": "Google Ads"},
        }
        unmatched_lease = {
            "attribution_event_date": "2026-03-01",
            "gross_lease_value": 12000,
            "net_effective_rent": 1000,
            "lease_term_months": 12,
            "concession_total": 0,
            "attribution_status": "unmatched",
            "lead_attribution": {},
        }

        main.apply_lease_revenue_to_buckets(buckets, matched_lease)
        main.apply_lease_revenue_to_buckets(buckets, unmatched_lease)
        bucket = main.finalize_roi_bucket(buckets["2026-03-01"])

        self.assertEqual(bucket["totals"]["attributed_leases"], 1)
        self.assertEqual(bucket["totals"]["unattributed_leases"], 1)
        self.assertEqual(bucket["totals"]["gross_lease_value"], 36000)
        self.assertEqual(bucket["totals"]["net_effective_revenue"], 33600)
        self.assertEqual(bucket["source_metrics"][0]["source_key"], "google_ads")

    def test_sync_property_date_for_roi_skips_availability(self):
        with mock.patch.object(main, "fetch_leads_for_date") as leads, \
             mock.patch.object(main, "fetch_events_for_date") as events, \
             mock.patch.object(main, "fetch_leases_for_date") as leases, \
             mock.patch.object(main, "fetch_invoices_for_date") as invoices, \
             mock.patch.object(main, "fetch_availability_for_date") as availability:
            main.sync_property_date_for_roi(100076494, "03/31/2026")

        leads.assert_not_called()
        events.assert_called_once()
        leases.assert_not_called()
        invoices.assert_called_once()
        availability.assert_not_called()

    def test_fetch_events_derives_leads_from_online_guest_card_events(self):
        api_result = {
            "prospects": {
                "prospect": [
                    {
                        "prospectId": "prospect-1",
                        "applicationId": "app-1",
                        "firstName": "Sam",
                        "lastName": "Resident",
                        "createdDate": "03/30/2026",
                        "leadSource": "Google Ads",
                        "events": {
                            "event": [
                                {
                                    "eventId": "event-lead",
                                    "typeId": "10",
                                    "eventReason": "Online Guest Card",
                                    "eventDate": "03/31/2026",
                                },
                                {
                                    "eventId": "event-app",
                                    "typeId": "12",
                                    "eventReason": "Application Status: Completed",
                                    "eventDate": "03/31/2026",
                                },
                            ]
                        },
                    }
                ]
            }
        }

        with mock.patch.object(main, "make_entrata_request", return_value=api_result), \
             mock.patch.object(main, "save_raw_data") as save_raw_data:
            main.fetch_events_for_date(100076494, "03/31/2026")

        lead_call = mock.call(100076494, "leads", mock.ANY, "03/31/2026")
        event_call = mock.call(100076494, "events", mock.ANY, "03/31/2026")
        self.assertIn(lead_call, save_raw_data.call_args_list)
        self.assertIn(event_call, save_raw_data.call_args_list)
        lead_items = save_raw_data.call_args_list[0].args[2]
        event_items = save_raw_data.call_args_list[1].args[2]
        self.assertEqual(len(lead_items), 1)
        self.assertEqual(lead_items[0]["leadEventId"], "event-lead")
        self.assertEqual(lead_items[0]["prospectKey"], "id:prospect-1")
        self.assertEqual(lead_items[0]["prospect_createdDate"], "03/30/2026")
        self.assertEqual(lead_items[0]["_sourceApi"], "getLeadEvents")
        self.assertEqual(len(event_items), 2)
        self.assertEqual(event_items[0]["prospect_prospectId"], "prospect-1")

    def test_fetch_events_saves_one_lead_per_prospect(self):
        api_result = {
            "prospects": {
                "prospect": [
                    {
                        "prospectId": "prospect-1",
                        "applicationId": "app-1",
                        "firstName": "Sam",
                        "lastName": "Resident",
                        "events": {
                            "event": [
                                {
                                    "eventId": "event-lead-1",
                                    "typeId": "10",
                                    "eventReason": "Online Guest Card",
                                    "eventDate": "03/31/2026",
                                },
                                {
                                    "eventId": "event-lead-2",
                                    "typeId": "10",
                                    "eventReason": "Online Guest Card",
                                    "eventDate": "03/31/2026",
                                },
                                {
                                    "eventId": "event-app",
                                    "typeId": "12",
                                    "eventReason": "Application Status: Completed",
                                    "eventDate": "03/31/2026",
                                },
                            ]
                        },
                    }
                ]
            }
        }

        with mock.patch.object(main, "make_entrata_request", return_value=api_result), \
             mock.patch.object(main, "save_raw_data") as save_raw_data:
            main.fetch_events_for_date(100076494, "03/31/2026")

        lead_items = save_raw_data.call_args_list[0].args[2]
        event_items = save_raw_data.call_args_list[1].args[2]
        self.assertEqual(len(lead_items), 1)
        self.assertEqual(lead_items[0]["leadEventId"], "event-lead-1")
        self.assertEqual(lead_items[0]["prospectKey"], "id:prospect-1")
        self.assertEqual(lead_items[0]["status"], "Application Completed")
        self.assertEqual(len(event_items), 3)

    def test_meta_ads_account_ids_are_normalized_to_act_prefix(self):
        self.assertEqual(main.normalize_meta_ads_account_id("123456789"), "act_123456789")
        self.assertEqual(main.normalize_meta_ads_account_id("act_987654321"), "act_987654321")

    def test_meta_ads_daily_rows_are_aggregated_by_date(self):
        rows = [
            {"date_start": "2026-03-01", "impressions": "100", "clicks": "10", "spend": "25.50", "frequency": "1.2", "actions": [{"action_type": "landing_page_view", "value": "7"}]},
            {"date_start": "2026-03-01", "impressions": "50", "clicks": "5", "spend": "9.50", "frequency": "1.0", "actions": [{"action_type": "landing_page_view", "value": "2"}]},
            {"date_start": "2026-03-02", "impressions": "30", "clicks": "3", "spend": "6.00", "frequency": "1.4", "actions": [{"action_type": "landing_page_view", "value": "1"}]},
        ]

        aggregated = main.aggregate_meta_ads_daily_rows(rows)

        self.assertEqual(len(aggregated), 2)
        self.assertEqual(aggregated[0]["date"], "2026-03-01")
        self.assertEqual(aggregated[0]["impressions"], 150)
        self.assertEqual(aggregated[0]["clicks"], 15)
        self.assertEqual(aggregated[0]["spend"], 35.0)
        self.assertEqual(aggregated[0]["landingPageViews"], 9.0)

    def test_meta_ads_property_filter_returns_empty_when_no_match(self):
        campaigns = [
            {"id": "1", "name": "Axis FB/IG Lead Gen"},
            {"id": "2", "name": "Promenade Place FB/IG Traffic"},
        ]

        filtered = main.filter_meta_ads_campaigns_for_property(campaigns, "The Hamptons")

        self.assertEqual(filtered, [])

    def test_meta_ads_property_filter_prefers_explicit_campaign_ids(self):
        campaigns = [
            {"id": "1", "name": "Axis FB/IG Lead Gen"},
            {"id": "2", "name": "Promenade Place FB/IG Traffic"},
        ]

        filtered = main.filter_meta_ads_campaigns_for_property(campaigns, "The Hamptons", campaign_ids=["2"])

        self.assertEqual(filtered, [campaigns[1]])


if __name__ == "__main__":
    unittest.main()
