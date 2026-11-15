from django.test import SimpleTestCase
from shapely.geometry import box

from apps.detection.validation import iou, match_footprints, metrics


class MatchingTests(SimpleTestCase):
    def test_iou(self):
        self.assertAlmostEqual(iou(box(0, 0, 10, 10), box(0, 0, 10, 10)), 1.0)
        self.assertAlmostEqual(iou(box(0, 0, 10, 10), box(5, 0, 15, 10)), 50 / 150)
        self.assertEqual(iou(box(0, 0, 1, 1), box(5, 5, 6, 6)), 0.0)

    def test_one_to_one_matching(self):
        pred = [box(0, 0, 10, 10), box(0.5, 0, 10.5, 10)]  # two detections on one building
        ref = [box(0, 0, 10, 10)]
        m = match_footprints(pred, ref)
        self.assertEqual(len(m), 1)
        self.assertEqual(m[0].pred, 0)  # the better overlap wins

    def test_metrics(self):
        ref = [box(0, 0, 10, 10), box(20, 0, 30, 10), box(40, 0, 50, 10), box(60, 0, 70, 10)]
        pred = [
            box(0, 0, 10, 10),  # exact
            box(21, 0, 31, 10),  # IoU 0.818
            box(40, 0, 44, 10),  # IoU 0.4 -> not a match
            box(100, 0, 110, 10),  # false positive
        ]
        m = metrics(pred, ref, pred_heights=[10, 20, 5, 7], ref_heights=[12, None, 5, 9])
        self.assertEqual(m["true_positives"], 2)
        self.assertAlmostEqual(m["precision"], 0.5)
        self.assertAlmostEqual(m["recall"], 0.5)
        self.assertAlmostEqual(m["f1"], 0.5)
        self.assertAlmostEqual(m["mean_iou"], (1 + 90 / 110) / 2, places=3)
        # Only the first match has a reference height: |10 - 12| = 2.
        self.assertEqual(m["height_compared"], 1)
        self.assertAlmostEqual(m["height_mae_m"], 2.0)
        self.assertAlmostEqual(m["height_bias_m"], -2.0)

    def test_empty_inputs(self):
        m = metrics([], [box(0, 0, 1, 1)])
        self.assertEqual(m["precision"], None)
        self.assertEqual(m["recall"], 0.0)
        m = metrics([box(0, 0, 1, 1)], [])
        self.assertEqual(m["recall"], None)
        self.assertIsNone(m["f1"])
