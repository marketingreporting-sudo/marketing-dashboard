import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "functions"))

import render_runtime


class LocalFalconMetricTests(unittest.TestCase):
    def test_average_solv_uses_available_keyword_values(self):
        rows = [
            {"keyword": "apartments near me", "solv": "22.5"},
            {"keyword": "downtown apartments", "solv": 37.5},
            {"keyword": "ignored missing value"},
        ]

        self.assertEqual(render_runtime._average_local_falcon_metric(rows, "solv"), 30.0)

    def test_trend_metrics_are_derived_from_scan_detail_points(self):
        reports = [
            {"report_key": "newer", "looker_date": "20260514", "keyword": "apartments", "arp": 99, "atrp": 99, "solv": 0},
            {"report_key": "older", "looker_date": "20260507", "keyword": "apartments", "arp": 99, "atrp": 99, "solv": 0},
        ]
        details = {
            "newer": {
                "data_points": [
                    {"rank": 1},
                    {"rank": 2},
                    {"rank": None},
                    {"rank": 8},
                ]
            },
            "older": {
                "data_points": [
                    {"rank": 4},
                    {"rank": None},
                    {"rank": None},
                    {"rank": 10},
                ]
            },
        }

        rows = render_runtime._normalize_local_falcon_trends(reports, details)

        self.assertEqual([row["date"] for row in rows], ["2026-05-07", "2026-05-14"])
        self.assertEqual(rows[0]["arp"], 7.0)
        self.assertEqual(rows[0]["atrp"], 14.0)
        self.assertEqual(rows[0]["solv"], 0.0)
        self.assertEqual(rows[1]["arp"], 3.67)
        self.assertEqual(rows[1]["atrp"], 8.0)
        self.assertEqual(rows[1]["solv"], 50.0)


if __name__ == "__main__":
    unittest.main()
