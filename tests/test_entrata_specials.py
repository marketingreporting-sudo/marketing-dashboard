import sys
import unittest
from unittest import mock

sys.path.insert(0, "/Users/steele/Desktop/Data Analysis/functions")

import main  # noqa: E402


class EntrataSpecialsTests(unittest.TestCase):
    def test_specials_hash_ignores_item_order(self):
        items_a = [
            {"specialId": "2", "title": "Two"},
            {"specialId": "1", "title": "One"},
        ]
        items_b = [
            {"specialId": "1", "title": "One"},
            {"specialId": "2", "title": "Two"},
        ]

        self.assertEqual(main.compute_specials_hash(items_a), main.compute_specials_hash(items_b))

    def test_store_property_specials_skips_unchanged_payload(self):
        current_snapshot = mock.Mock()
        current_snapshot.exists = True
        current_snapshot.to_dict.return_value = {"specials_hash": "same-hash"}

        current_doc = mock.Mock()
        current_doc.get.return_value = current_snapshot

        collection_ref = mock.Mock()
        collection_ref.document.return_value = current_doc

        property_doc = mock.Mock()
        property_doc.collection.return_value = collection_ref

        db = mock.Mock()
        db.collection.return_value.document.return_value = property_doc

        with mock.patch.object(main.firestore, "client", return_value=db), \
             mock.patch.object(main, "compute_specials_hash", return_value="same-hash"):
            result = main.store_property_specials(124441, [{"specialId": "1", "title": "Spring"}])

        self.assertFalse(result["changed"])
        current_doc.set.assert_not_called()

    def test_extract_special_items_handles_nested_result(self):
        result = {
            "specials": {
                "special": [
                    {"specialId": "1", "title": "Spring"},
                    {"specialId": "2", "title": "Summer"},
                ]
            }
        }

        items = main.extract_special_items(result)

        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["specialId"], "1")


if __name__ == "__main__":
    unittest.main()
