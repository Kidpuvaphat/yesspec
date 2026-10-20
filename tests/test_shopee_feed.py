import csv
import tempfile
import unittest
from pathlib import Path

from inspect_shopee_feed import inspect_feed


class ShopeeFeedTests(unittest.TestCase):
    def write_feed(self, directory, values):
        path = Path(directory) / 'feed.csv'
        with path.open('w', encoding='utf-8-sig', newline='') as stream:
            writer = csv.writer(stream)
            writer.writerow(['shopid', 'itemid', 'item_sold', 'global_catid1',
                             'global_catid2', 'global_catid3', 'title'])
            for shop, item, sold, title in values:
                writer.writerow([shop, item, sold, '100013', '', '', title])
        return path

    def test_missing_sales_and_zero_are_distinct_and_no_thirty_day_claim(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_feed(directory, [('1', '2', '', 'A'), ('1', '3', '0', 'B'),
                                                ('1', '4', '100', 'C'), ('1', '5', '1k+', 'D')])
            report = inspect_feed(path)
            self.assertEqual(report['counts']['missing_sales_rows'], 1)
            self.assertEqual(report['counts']['zero_sales_rows'], 1)
            self.assertEqual(report['counts']['invalid_sales_rows'], 1)
            self.assertEqual(report['sales_period'], 'unknown')
            self.assertFalse(report['verified_30_day'])
            self.assertIsNone(report['marketplace_coverage_percent'])
            self.assertIsNone(report['catalog_complete'])

    def test_deduplicates_by_shop_and_item_and_reads_multiline_csv(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_feed(directory, [('1', '2', '1', 'A\nB, C'), ('1', '2', '2', 'D'),
                                                ('3', '2', '3', 'E'), ('x', '2', '1', 'F')])
            report = inspect_feed(path)
            self.assertEqual(report['counts']['rows'], 4)
            self.assertEqual(report['unique_listings'], 2)
            self.assertEqual(report['counts']['duplicate_identity_rows'], 1)
            self.assertEqual(report['counts']['invalid_identity_rows'], 1)
            self.assertEqual(report['category_paths'][0]['rows'], 4)
            self.assertEqual(len(report['source_sha256']), 64)

    def test_unfinished_download_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'completed'):
            inspect_feed(Path('feed.csv.crdownload'))

    def test_incomplete_rows_are_counted_not_interpreted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_feed(directory, [('1', '2', '3', 'A')])
            with path.open('a') as stream:
                stream.write('1,3\n')
            report = inspect_feed(path)
            self.assertEqual(report['counts']['rows'], 2)
            self.assertEqual(report['counts']['malformed_rows'], 1)
            self.assertEqual(report['unique_listings'], 1)

    def test_wrong_schema_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'other.csv'
            path.write_text('name,orders\nA,10\n')
            with self.assertRaisesRegex(ValueError, 'Missing feed columns'):
                inspect_feed(path)


if __name__ == '__main__':
    unittest.main()
