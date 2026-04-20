import sys
import unittest

sys.path.insert(0, "/Users/steele/Desktop/Data Analysis/functions")

import render_supabase_admin_content as website_content  # noqa: E402


class WebsiteManagerSyncTests(unittest.TestCase):
    def test_build_derived_content_summarizes_specials_and_pricing(self):
        specials_row = {
            "specials": [
                {"title": "One Month Free"},
                {"title": "Waived App Fees"},
            ],
            "last_synced_at": "2026-04-20T10:15:00+00:00",
        }
        pricing_row = {
            "availability_url": "https://example.com/floorplans",
            "last_synced_at": "2026-04-20T10:20:00+00:00",
            "floorplans": [
                {"MarketRent": {"@attributes": {"Min": "1499", "Max": "1899"}}},
                {"MarketRent": {"@attributes": {"Min": "1599", "Max": "1999"}}},
            ],
            "units": [
                {
                    "@attributes": {"Status": "Available"},
                    "UnitSpace": {
                        "Space": {
                            "Rent": {"@attributes": {"MinRent": "1525", "MaxRent": "1525"}}
                        }
                    },
                }
            ],
        }

        derived = website_content._build_derived_content(specials_row, pricing_row)

        self.assertEqual(derived["specialsCount"], 2)
        self.assertIn("One Month Free", derived["specialsSummary"])
        self.assertEqual(derived["startingPrice"], "$1,525")
        self.assertEqual(derived["availableUnitCount"], 1)
        self.assertEqual(derived["availabilityUrl"], "https://example.com/floorplans")

    def test_build_wordpress_payload_maps_dashboard_and_derived_fields(self):
        record = {
            "propertyName": "Test Property",
            "websiteUrl": "https://example.com",
            "content": {
                "heroHeadline": "Live better here.",
                "heroPrimaryCtaUrl": "/contact",
                "availabilityNote": "Pricing subject to change.",
            },
            "derivedContent": {
                "pricingSummary": "Now leasing from $1,499",
                "availabilitySummary": "4 units available | 2 floorplans",
                "specialsSummary": "Waived fees",
                "availabilityUrl": "https://example.com/floorplans",
                "startingPrice": "$1,499",
                "priceRange": "$1,499 - $1,899",
                "specialsCount": 1,
                "floorplanCount": 2,
                "availableUnitCount": 4,
            },
        }

        payload = website_content._build_wordpress_payload(record)

        self.assertEqual(payload["property_name"], "Test Property")
        self.assertEqual(payload["hero_headline"], "Live better here.")
        self.assertEqual(payload["primary_cta_url"], "/contact")
        self.assertEqual(payload["availability_note"], "Pricing subject to change.")
        self.assertEqual(payload["pricing_summary"], "Now leasing from $1,499")
        self.assertEqual(payload["available_unit_count"], 4)


if __name__ == "__main__":
    unittest.main()
