import sys
import unittest

sys.path.insert(0, "/Users/steele/Desktop/Data Analysis/functions")

import render_supabase_heatmaps as heatmaps  # noqa: E402


class SiteAuditAiTests(unittest.TestCase):
    def test_merge_ai_page_audit_result_keeps_deterministic_findings(self):
        deterministic = {
            "pageId": "page-1",
            "path": "/",
            "score": 82,
            "issues": ["Missing meta description."],
            "recommendations": ["Add a concise meta description."],
        }
        ai_result = {
            "score": 64,
            "summary": "Hero lacks a clear value-add and pricing is not visible.",
            "checklist": [
                {
                    "key": "homepage_value_add",
                    "label": "Homepage includes a clear value-add",
                    "status": "fail",
                    "score": 45,
                    "severity": "high",
                    "evidence": "The hero only shows a generic welcome headline.",
                    "recommendation": "Add a concrete resident benefit above the fold.",
                }
            ],
            "issues": [
                {
                    "rubricKey": "homepage_value_add",
                    "severity": "high",
                    "issue": "Homepage value-add is not specific.",
                    "evidence": "The hero copy is generic.",
                    "recommendation": "Add a concrete resident benefit above the fold.",
                }
            ],
            "recommendations": ["Add a concrete resident benefit above the fold."],
        }

        merged = heatmaps._merge_ai_page_audit_result(deterministic, ai_result)

        self.assertEqual(merged["score"], 64)
        self.assertEqual(merged["aiScore"], 64)
        self.assertIn("Missing meta description.", merged["issues"])
        self.assertIn("Homepage value-add is not specific.", merged["issues"])
        self.assertIn("Add a concise meta description.", merged["recommendations"])
        self.assertEqual(merged["aiAudit"]["summary"], ai_result["summary"])

    def test_apply_ai_site_audit_skips_when_key_is_missing(self):
        pages = [{"id": "page-1", "path": "/", "screenshots": []}]
        page_results = [{"pageId": "page-1", "path": "/", "score": 90, "issues": [], "recommendations": []}]

        merged, meta = heatmaps._apply_ai_site_audit(
            pages,
            page_results,
            property_id="property-1",
            site_id=None,
            include_ai=True,
        )

        self.assertEqual(merged, page_results)
        self.assertEqual(meta["status"], "not_configured")
        self.assertFalse(meta["configured"])

    def test_normalize_ai_result_preserves_non_passing_checklist_recommendations(self):
        normalized = heatmaps._normalize_ai_page_result(
            {
                "path": "/",
                "score": 78,
                "summary": "Mostly sound but pricing needs manual verification.",
                "checklist": [
                    {
                        "key": "pricing_accuracy",
                        "label": "Pricing is accurate",
                        "status": "not_verifiable",
                        "score": 60,
                        "severity": "medium",
                        "evidence": "Pricing is not visible in the provided screenshot.",
                        "recommendation": "Verify pricing against Entrata before marking this page complete.",
                    }
                ],
                "issues": [],
                "recommendations": [],
                "priority_actions": [],
            },
            {"path": "/"},
        )

        self.assertIn("Verify pricing against Entrata before marking this page complete.", normalized["recommendations"])

    def test_deterministic_audit_uses_entrata_truth_data(self):
        page = {
            "id": "page-1",
            "path": "/floor-plans/",
            "title": "Floor Plans",
            "metaDescription": "Explore floor plans.",
            "headings": [{"level": "h1", "text": "Floor Plans"}],
            "ctas": [{"label": "Schedule a Tour"}],
            "internalLinks": [],
            "promoDateStrings": [],
            "pageStructure": {"imageCount": 3, "linkCount": 5, "formCount": 0},
            "screenshots": [{"id": "shot-1"}],
        }
        entrata_context = {
            "pricing": {
                "hasSnapshot": True,
                "minPrice": 1500,
                "availableUnitCount": 2,
            },
            "specials": {
                "hasSnapshot": True,
                "specialCount": 1,
                "titles": ["One Month Free"],
            },
        }

        result = heatmaps._audit_page(page, entrata_context)

        self.assertTrue(any("Entrata pricing exists" in issue for issue in result["issues"]))
        self.assertTrue(any("Entrata has available units" in issue for issue in result["issues"]))
        self.assertTrue(any("Entrata has active specials" in issue for issue in result["issues"]))

    def test_cloudflare_challenge_text_is_not_ready_for_screenshot(self):
        state = heatmaps._screenshot_page_challenge_text_state(
            "Arcadiaapts.com Performing security verification Cloudflare Verifying..."
        )

        self.assertTrue(state["isChallenge"])
        self.assertFalse(
            heatmaps._screenshot_page_has_real_content(
                {
                    "isChallenge": True,
                    "bodyTextLength": 240,
                    "h1Count": 1,
                    "linkCount": 4,
                    "imageCount": 2,
                }
            )
        )

    def test_real_property_content_is_ready_for_screenshot(self):
        self.assertTrue(
            heatmaps._screenshot_page_has_real_content(
                {
                    "isChallenge": False,
                    "bodyTextLength": 80,
                    "h1Count": 1,
                    "linkCount": 2,
                    "imageCount": 1,
                    "ctaLikeCount": 1,
                }
            )
        )


if __name__ == "__main__":
    unittest.main()
