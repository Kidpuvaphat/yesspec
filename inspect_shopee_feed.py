#!/usr/bin/env python3
"""Audit a completed Shopee Affiliate CSV without importing unverified rankings.

Uses the actual CSV columns seen in the account's Product Feed on 2026-10-19.
Reading a whole file does not establish whole-market coverage or a sales period.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from build_shopee_rankings import identity


def inspect_feed(path: Path):
    path = Path(path)
    if path.suffix.lower() != '.csv':
        raise ValueError('Use a completed .csv file, not an in-progress download.')
    before = path.stat()
    csv.field_size_limit(10_000_000)
    counts = Counter()
    categories = Counter()
    seen = set()
    with path.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream, strict=True)
        columns = reader.fieldnames or []
        required = {'shopid', 'itemid', 'item_sold', 'global_catid1', 'global_catid2', 'global_catid3'}
        if not required.issubset(columns):
            raise ValueError(f'Missing feed columns: {sorted(required - set(columns))}')
        if len(columns) != len(set(columns)):
            raise ValueError('Duplicate column names cannot be interpreted safely.')
        for row in reader:
            counts['rows'] += 1
            if None in row or any(v is None for v in row.values()):
                counts['malformed_rows'] += 1
                continue
            key = identity(row['shopid'].strip(), row['itemid'].strip())
            if key:
                counts['valid_identity_rows'] += 1
                if key in seen:
                    counts['duplicate_identity_rows'] += 1
                seen.add(key)
            else:
                counts['invalid_identity_rows'] += 1
            sold = row['item_sold'].strip()
            if not sold:
                counts['missing_sales_rows'] += 1
            elif sold.isascii() and sold.isdigit():
                counts['numeric_sales_rows'] += 1
                if int(sold) == 0:
                    counts['zero_sales_rows'] += 1
            else:
                counts['invalid_sales_rows'] += 1
            category = tuple(row.get(field, '').strip() for level in (1, 2, 3)
                             for field in (f'global_catid{level}', f'global_category{level}'))
            categories[category] += 1
    sha256 = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            sha256.update(chunk)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError('File changed during inspection; wait for download completion.')
    count_names = ('rows', 'malformed_rows', 'valid_identity_rows', 'invalid_identity_rows',
                   'duplicate_identity_rows', 'numeric_sales_rows', 'zero_sales_rows',
                   'missing_sales_rows', 'invalid_sales_rows')
    return {
        'schema_version': 1,
        'kind': 'shopee_affiliate_feed_file_audit',
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'source_filename': path.name,
        'source_bytes': after.st_size,
        'source_sha256': sha256.hexdigest(),
        'source_file_read_to_end': True,
        'catalog_complete': None,
        'marketplace_coverage_percent': None,
        'scope': 'provided_affiliate_feed',
        'sales_field': 'item_sold',
        'sales_period': 'unknown',
        'verified_30_day': False,
        'period_evidence': None,
        'source_snapshot_time': None,
        'notes': [
            'File read time and filename date are not proof of the sales measurement window.',
            'All rows in this file were read; other feed files and catalog exclusions are not established.',
            'item_sold is preserved as an unknown-period metric; missing sales are not zero.',
            'Category paths below are reported by the feed, not validated editorial-category mappings.',
        ],
        'columns': columns,
        'counts': {name: counts[name] for name in count_names},
        'unique_listings': len(seen),
        'category_paths': [
            {'levels': [{'id': path_[i], 'name': path_[i + 1]} for i in (0, 2, 4)],
             'rows': count}
            for path_, count in sorted(categories.items())
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv_file', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    report = inspect_feed(args.csv_file)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + '.tmp')
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(args.output)
    print(json.dumps({'output': str(args.output), 'counts': report['counts'],
                      'unique_listings': report['unique_listings'],
                      'category_paths': len(report['category_paths']),
                      'sales_period': report['sales_period']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
