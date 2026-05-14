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
                    "confidence": "High",
                    "confidenceScore": 95,
                    "issue": "Homepage value-add is not specific.",
                    "evidence": "The hero copy is generic.",
                    "evidenceSource": "desktop screenshot",
                    "affectedPage": "/",
                    "recommendation": "Add a concrete resident benefit above the fold.",
                    "manualVerificationNeeded": False,
                    "manualVerificationNote": "",
                    "source": "openai_vision",
                }
            ],
            "recommendations": ["Add a concrete resident benefit above the fold."],
        }

        merged = heatmaps._merge_ai_page_audit_result(deterministic, ai_result)

        self.assertEqual(merged["score"], 64)
        self.assertEqual(merged["aiScore"], 64)
        self.assertIn("Missing meta description.", merged["issues"])
        self.assertIn("Homepage value-add is not specific.", merged["issues"])
        self.assertEqual(merged["aiIssues"][0]["evidenceSource"], "desktop screenshot")
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
                    "confidence": "low",
                    "evidence": "Pricing is not visible in the provided screenshot.",
                    "evidence_source": "desktop screenshot",
                    "affected_page": "/",
                    "recommendation": "Verify pricing against Entrata before marking this page complete.",
                    "manual_verification_needed": True,
                    "manual_verification_note": "Pricing could not be verified from the screenshot.",
                }
            ],
            "issues": [],
                "recommendations": [],
                "priority_actions": [],
            },
            {"path": "/"},
        )

        self.assertIn("Verify pricing against Entrata before marking this page complete.", normalized["recommendations"])
        self.assertTrue(normalized["checklist"][0]["manualVerificationNeeded"])
        self.assertEqual(normalized["checklist"][0]["confidence"], "low")

    def test_normalize_ai_result_preserves_evidence_first_issue_fields(self):
        normalized = heatmaps._normalize_ai_page_result(
            {
                "path": "/floor-plans/",
                "score": 52,
                "summary": "Pricing is likely missing from the floor plan page.",
                "checklist": [],
                "issues": [
                    {
                        "rubric_key": "pricing_accuracy",
                        "severity": "high",
                        "confidence": "high",
                        "issue": "Pricing is not visible on the floor plan page.",
                        "evidence": "The desktop screenshot shows floor plan cards without rent values.",
                        "evidence_source": "desktop screenshot and page metadata",
                        "affected_page": "/floor-plans/",
                        "recommendation": "Show current starting rent beside each floor plan.",
                        "manual_verification_needed": False,
                        "manual_verification_note": "",
                    }
                ],
                "recommendations": [],
                "priority_actions": [],
            },
            {"path": "/floor-plans/"},
        )

        issue = normalized["issues"][0]
        self.assertEqual(issue["rubricKey"], "pricing_accuracy")
        self.assertEqual(issue["confidence"], "High")
        self.assertEqual(issue["evidenceSource"], "desktop screenshot and page metadata")
        self.assertEqual(issue["affectedPage"], "/floor-plans/")
        self.assertFalse(issue["manualVerificationNeeded"])

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
        self.assertTrue(result["reconciliationFindings"])

    def test_entrata_reconciliation_checks_explicit_truth_mismatches(self):
        page = {
            "id": "page-1",
            "path": "/floor-plans/",
            "title": "Floor Plans",
            "metaDescription": "Explore floor plans.",
            "headings": [{"level": "h1", "text": "Floor Plans"}],
            "ctas": [{"label": "Apply Now", "href": "#"}],
            "internalLinks": [],
            "promoDateStrings": [],
        }
        entrata_context = {
            "pricing": {
                "hasSnapshot": True,
                "minPrice": 1500,
                "maxPrice": 1900,
                "availableUnitCount": 3,
                "floorplanCount": 2,
                "floorplanNames": ["Aspen", "Birch"],
            },
            "specials": {
                "hasSnapshot": True,
                "specialCount": 1,
                "titles": ["Six Weeks Free"],
            },
            "contactInfo": {"hasSource": False},
        }

        findings = heatmaps._site_audit_entrata_reconciliation_findings(page, entrata_context)
        issues = [item["issue"] for item in findings]

        self.assertTrue(any("pricing" in issue.lower() for issue in issues))
        self.assertTrue(any("available units" in issue.lower() or "availability" in issue.lower() for issue in issues))
        self.assertTrue(any("floor plan names" in issue.lower() for issue in issues))
        self.assertTrue(any("active specials" in issue.lower() for issue in issues))
        self.assertTrue(any("apply link" in issue.lower() for issue in issues))
        self.assertTrue(all(item.get("confidenceScore") for item in findings))

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

    def test_property_risk_score_weights_severity_confidence_and_business_urgency(self):
        raw_data = {
            "entrataAuditContext": {
                "pricing": {"hasSnapshot": True, "availableUnitCount": 4},
                "specials": {"hasSnapshot": True, "specialCount": 1},
            }
        }
        pricing_reason = heatmaps._site_audit_enrich_reason_risk(
            {
                "category": "Pricing",
                "rubricKey": "pricing_accuracy",
                "severity": "high",
                "issue": "Entrata pricing exists, but website pricing is not visible.",
                "evidence": "Entrata pricing exists and the screenshot does not show rent.",
                "path": "/floor-plans/",
            },
            raw_data=raw_data,
            score_change=-12,
            site_confidence={"score": 82, "label": "High"},
        )
        contact_reason = heatmaps._site_audit_enrich_reason_risk(
            {
                "category": "Website QA",
                "rubricKey": "contact_info_hours",
                "severity": "medium",
                "issue": "Contact hours are not visible in screenshot.",
                "evidence": "Screenshot does not show office hours.",
                "path": "/contact/",
                "status": "not_verifiable",
            },
            raw_data=raw_data,
            score_change=None,
            site_confidence={"score": 55, "label": "Medium"},
        )

        self.assertGreater(pricing_reason["riskScore"], contact_reason["riskScore"])
        self.assertEqual(pricing_reason["confidence"], "High")
        self.assertLess(contact_reason["confidenceScore"], pricing_reason["confidenceScore"])

    def test_heatmap_behavior_findings_flag_engagement_failures(self):
        page_results = [{"path": "/floor-plans/", "ctaCount": 1}]
        entrata_context = {
            "pricing": {"hasSnapshot": True, "minPrice": 1500},
            "specials": {"hasSnapshot": True, "specialCount": 1},
        }
        heatmap_context = {
            "status": "ok",
            "summary": {
                "totals": {
                    "sessions": 10,
                    "ctaClicks": 0,
                    "avgAbandonmentDepthPct": 0.3,
                    "avgScrollDepthPct": 0.35,
                },
                "scroll": {"reach": {"50": {"percent": 0.25}}},
                "anomalies": {
                    "rageClicks": {"count": 1, "clusters": [{"label": "Hero image", "path": "/"}]},
                    "deadClicks": {"count": 4, "targets": [{"label": "View availability", "path": "/floor-plans/"}]},
                    "ctaFrustration": {"count": 0, "clusters": []},
                },
                "topTargets": [],
            },
            "mobileSummary": {
                "totals": {"sessions": 8, "ctaClicks": 0},
                "scroll": {"reach": {"50": {"percent": 0.2}}},
                "topTargets": [],
            },
        }

        findings = heatmaps._site_audit_heatmap_behavior_findings(heatmap_context, page_results, entrata_context)
        issues = [item["issue"] for item in findings]

        self.assertTrue(any("not clicking" in issue for issue in issues))
        self.assertTrue(any("rage-clicking" in issue for issue in issues))
        self.assertTrue(any("look actionable" in issue for issue in issues))
        self.assertTrue(any("abandon before reaching pricing" in issue for issue in issues))
        self.assertTrue(any("Mobile users are not reaching floor plans" in issue for issue in issues))

        apply_context = {
            "status": "ok",
            "summary": {
                "totals": {"sessions": 10, "ctaClicks": 3, "avgAbandonmentDepthPct": 0.7, "avgScrollDepthPct": 0.7},
                "scroll": {"reach": {"50": {"percent": 0.8}}},
                "anomalies": {
                    "rageClicks": {"count": 0, "clusters": []},
                    "deadClicks": {"count": 0, "targets": []},
                    "ctaFrustration": {"count": 1, "clusters": [{"label": "Apply Now", "path": "/floor-plans/"}]},
                },
                "topTargets": [{"label": "Apply Now", "ctaClicks": 3}],
            },
            "mobileSummary": {"totals": {"sessions": 0}, "scroll": {"reach": {"50": {"percent": 0}}}, "topTargets": []},
        }
        apply_findings = heatmaps._site_audit_heatmap_behavior_findings(apply_context, page_results, entrata_context)
        self.assertTrue(any("Apply button gets clicks" in item["issue"] for item in apply_findings))

    def test_sitemap_discovery_flags_pages_outside_known_snapshots(self):
        original_fetch = heatmaps._site_audit_fetch_sitemap_urls
        try:
            heatmaps._site_audit_fetch_sitemap_urls = lambda origin: {
                "status": "ok",
                "sitemapUrl": f"{origin}/sitemap.xml",
                "httpStatus": 200,
                "urls": [
                    f"{origin}/",
                    f"{origin}/floor-plans/",
                    f"{origin}/specials/",
                ],
                "error": "",
            }
            discovery = heatmaps._site_audit_sitemap_discovery(
                [{"path": "/", "url": "https://example.com/"}]
            )
        finally:
            heatmaps._site_audit_fetch_sitemap_urls = original_fetch

        self.assertEqual(discovery["discoveredMissingCount"], 2)
        self.assertTrue(any("Sitemap includes pages" in item["issue"] for item in discovery["findings"]))

    def test_technical_context_combines_findings_without_browser_dependency(self):
        original_links = heatmaps._site_audit_internal_link_checks
        original_discovery = heatmaps._site_audit_sitemap_discovery
        original_browser = heatmaps._site_audit_browser_technical_checks
        original_lighthouse = heatmaps._site_audit_lighthouse_checks
        try:
            heatmaps._site_audit_internal_link_checks = lambda pages: (
                [{"url": "https://example.com/broken", "status": 404}],
                [
                    heatmaps._site_audit_technical_finding(
                        category="Broken links",
                        rubric_key="page_load_desktop_mobile",
                        severity="medium",
                        issue="Internal link HTTP failure detected.",
                        evidence="Example returned 404.",
                        recommendation="Fix the link.",
                    )
                ],
            )
            heatmaps._site_audit_sitemap_discovery = lambda pages: {"status": "ok", "findings": []}
            heatmaps._site_audit_browser_technical_checks = lambda pages, site_key=None: {
                "status": "ok",
                "findings": [
                    heatmaps._site_audit_technical_finding(
                        category="Mobile/load",
                        rubric_key="page_load_desktop_mobile",
                        severity="medium",
                        issue="Mobile viewport has horizontal overflow.",
                        evidence="Overflow by 80px.",
                        recommendation="Constrain wide elements.",
                    )
                ],
            }
            heatmaps._site_audit_lighthouse_checks = lambda pages: {"status": "unavailable", "findings": []}

            context = heatmaps._site_audit_technical_context([{"path": "/", "url": "https://example.com/"}], site_key="site-1")
        finally:
            heatmaps._site_audit_internal_link_checks = original_links
            heatmaps._site_audit_sitemap_discovery = original_discovery
            heatmaps._site_audit_browser_technical_checks = original_browser
            heatmaps._site_audit_lighthouse_checks = original_lighthouse

        issues = [item["issue"] for item in context["findings"]]
        self.assertIn("Internal link HTTP failure detected.", issues)
        self.assertIn("Mobile viewport has horizontal overflow.", issues)
        self.assertEqual(context["linkChecks"][0]["status"], 404)

    def test_application_link_status_checks_catch_blocked_apply_links(self):
        checks, findings = heatmaps._site_audit_application_link_status_checks(
            [
                {
                    "path": "/floor-plans/",
                    "url": "https://example.com/floor-plans/",
                    "ctas": [{"label": "Apply Now", "href": "#"}],
                    "internalLinks": [],
                }
            ]
        )

        self.assertEqual(checks[0]["status"], 0)
        self.assertTrue(any("Application link failed" in item["issue"] for item in findings))

    def test_trend_summary_detects_regressions_and_resolutions(self):
        previous = {
            "audited_at": "2026-05-13T12:00:00+00:00",
            "performance_score": 92,
            "issues": [
                {"path": "/", "issue": "Homepage CTA is weak.", "category": "CTA", "severity": "medium"},
                {"path": "/specials/", "issue": "Old special is visible.", "category": "Specials", "severity": "medium"},
            ],
            "broken_links": [],
            "stale_date_findings": [],
            "performance_notes": [
                {
                    "path": "/",
                    "score": 92,
                    "screenshotCount": 1,
                    "screenshots": [{"deviceType": "desktop", "contentHash": "old-home"}],
                },
                {
                    "path": "/specials/",
                    "score": 75,
                    "screenshotCount": 1,
                    "screenshots": [{"deviceType": "desktop", "contentHash": "old-specials"}],
                },
            ],
            "raw_data": {
                "behaviorAudit": {"summary": {"sessions": 14}},
                "categoryScores": [{"key": "homepage_cta", "score": 88}],
            },
        }
        current = {
            "audited_at": "2026-05-14T12:00:00+00:00",
            "performance_score": 71,
            "issues": [
                {"path": "/", "issue": "Homepage CTA is weak.", "category": "CTA", "severity": "medium"},
                {"path": "/floor-plans/", "issue": "Pricing is not visible.", "category": "Pricing", "severity": "high"},
                {"path": "/", "issue": "Redstone tracking snippet is missing from checked pages.", "category": "Website QA", "severity": "high"},
            ],
            "broken_links": [],
            "stale_date_findings": [],
            "performance_notes": [
                {
                    "path": "/",
                    "score": 71,
                    "screenshotCount": 1,
                    "screenshots": [{"deviceType": "desktop", "contentHash": "new-home"}],
                },
                {
                    "path": "/floor-plans/",
                    "score": 60,
                    "screenshotCount": 1,
                    "screenshots": [{"deviceType": "desktop", "contentHash": "floor"}],
                },
            ],
            "raw_data": {
                "behaviorAudit": {"summary": {"sessions": 0}},
                "categoryScores": [{"key": "homepage_cta", "score": 70}],
            },
        }

        trend = heatmaps._site_audit_trend_summary([current, previous])

        self.assertTrue(trend["scoreDropped"])
        self.assertEqual(trend["scoreChange"], -21)
        self.assertEqual(trend["newIssueCount"], 2)
        self.assertEqual(trend["recurringIssueCount"], 1)
        self.assertEqual(trend["resolvedIssueCount"], 1)
        self.assertEqual(trend["screenshotChangedCount"], 1)
        self.assertEqual(trend["pageDisappearedCount"], 1)
        self.assertTrue(trend["trackingStoppedReporting"])
        event_types = {item["type"] for item in trend["regressionEvents"]}
        self.assertIn("new_issue", event_types)
        self.assertIn("resolved_issue", event_types)
        self.assertIn("score_dropped", event_types)
        self.assertIn("screenshot_changed", event_types)
        self.assertIn("page_disappeared", event_types)
        self.assertIn("tracking_stopped_reporting", event_types)


if __name__ == "__main__":
    unittest.main()
