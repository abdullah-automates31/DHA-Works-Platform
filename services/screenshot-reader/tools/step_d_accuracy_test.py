#!/usr/bin/env python
"""
Step D: Real Screenshot Accuracy Testing Script

This script tests the OCR engine against real transaction screenshots.
It reads screenshots from fixtures/real/, extracts fields, compares with
ground truth, and generates an accuracy CSV matrix.

Usage:
    1. Place real screenshots in fixtures/real/ (git-ignored)
    2. Run from services/screenshot-reader:  .venv/Scripts/python tools/step_d_accuracy_test.py
    3. Enter ground truth values when prompted
    4. Results saved to accuracy_report.csv and accuracy_summary.txt

The script never uploads images or extracted data anywhere.
"""

import csv
import json
import os
import sys
from pathlib import Path

# Add the app directory to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.pipeline import read_picture
from app.engines.paddle import PaddleEngine

REAL_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "real"
GROUND_TRUTH_FILE = Path(__file__).resolve().parent.parent / "fixtures" / "real" / "ground_truth.json"
REPORT_CSV = Path(__file__).resolve().parent.parent / "accuracy_report.csv"
SUMMARY_TXT = Path(__file__).resolve().parent.parent / "accuracy_summary.txt"

FIELDS = [
    "app", "amount", "transaction_id", "paid_at",
    "receiver_name", "receiver_account", "status"
]

CSV_HEADERS = [
    "image", "app",
    "expected_amount", "extracted_amount", "amount_match",
    "expected_txn_id", "extracted_txn_id", "txn_id_match",
    "expected_date", "extracted_date", "date_match",
    "expected_receiver", "extracted_receiver", "receiver_match",
    "expected_status", "extracted_status", "status_match",
    "verdict"
]

def load_ground_truth():
    """Load existing ground truth from JSON file."""
    if GROUND_TRUTH_FILE.exists():
        with open(GROUND_TRUTH_FILE, "r") as f:
            return json.load(f)
    return {}

def save_ground_truth(gt):
    """Save ground truth to JSON file."""
    GROUND_TRUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(GROUND_TRUTH_FILE, "w") as f:
        json.dump(gt, f, indent=2)

def get_screenshot_files():
    """Get list of screenshot files in fixtures/real/."""
    if not REAL_DIR.exists():
        return []
    exts = {".png", ".jpg", ".jpeg", ".webp"}
    return sorted([f for f in REAL_DIR.iterdir() if f.suffix.lower() in exts])

def prompt_ground_truth(image_path, extracted):
    """Prompt user for ground truth values for one screenshot.
    Shows extracted values for reference only; owner must enter verified values from the actual receipt."""
    print(f"\n{'='*60}")
    print(f"Image: {image_path.name}")
    print(f"{'='*60}")
    print("Extracted values (for reference only - do not copy):")
    for k, v in extracted.items():
        print(f"  {k}: {v}")
    print("\nEnter ground truth from the ACTUAL TRANSACTION RECEIPT (not from OCR):")
    print("  - Press Enter to leave a field blank (if not visible on receipt)")
    print("  - Type 'skip' to skip this image entirely")
    print("  - For amount: enter numbers only (e.g., 50 or 50.00)")
    
    gt = {}
    for field in FIELDS:
        prompt = f"  {field}: "
        val = input(prompt).strip()
        if val.lower() == "skip":
            return None
        if val == "":
            gt[field] = None
        else:
            # Try to convert to appropriate type
            if field == "amount":
                try:
                    gt[field] = int(val) if "." not in val else float(val)
                except ValueError:
                    gt[field] = val
            else:
                gt[field] = val
    return gt

def compare_values(expected, extracted):
    """Compare expected and extracted values. Returns (match, extracted_str, counted).
    counted=False when expected is None (field left blank by owner), so it doesn't affect accuracy."""
    if expected is None:
        return None, str(extracted) if extracted is not None else "", False
    if extracted is None:
        return False, "", True
    
    # For strings, normalize whitespace and case
    if isinstance(expected, str) and isinstance(extracted, str):
        exp_norm = expected.strip().lower()
        ext_norm = extracted.strip().lower()
        return exp_norm == ext_norm, extracted, True
    
    # For numbers
    if isinstance(expected, (int, float)) and isinstance(extracted, (int, float)):
        return expected == extracted, str(extracted), True
    
    # Mixed types - convert to string
    return str(expected).strip().lower() == str(extracted).strip().lower(), str(extracted), True

def determine_verdict(matches):
    """Determine overall verdict from field matches."""
    # Critical fields: amount and transaction_id must match
    critical = matches.get("amount", False) and matches.get("transaction_id", False)
    if not critical:
        return "flagged"
    
    # If all fields match
    if all(matches.values()):
        return "matches"
    
    # Some non-critical fields don't match
    return "flagged"

def run_accuracy_test():
    """Main accuracy test workflow."""
    print("Step D: Real Screenshot Accuracy Testing")
    print("=" * 60)
    
    # Initialize OCR engine
    print("Loading PaddleOCR engine...")
    engine = PaddleEngine()
    print("Engine loaded.")
    
    # Get screenshot files
    screenshots = get_screenshot_files()
    if not screenshots:
        print(f"\nNo screenshots found in {REAL_DIR}")
        print("Place real transaction screenshots (PNG/JPG/WebP) in that directory.")
        return
    
    print(f"\nFound {len(screenshots)} screenshot(s):")
    for s in screenshots:
        print(f"  {s.name}")
    
    # Load existing ground truth
    ground_truth = load_ground_truth()
    
    # Process each screenshot
    results = []
    for img_path in screenshots:
        print(f"\nProcessing {img_path.name}...")
        
        # Read image and extract
        with open(img_path, "rb") as f:
            data = f.read()
        extracted, sha = read_picture(data, engine)
        
        # Check if we have ground truth
        if img_path.name in ground_truth:
            gt = ground_truth[img_path.name]
            print(f"  Using existing ground truth for {img_path.name}")
        else:
            gt = prompt_ground_truth(img_path, extracted)
            if gt is None:
                print(f"  Skipped {img_path.name}")
                continue
            ground_truth[img_path.name] = gt
            save_ground_truth(ground_truth)
            print(f"  Saved ground truth for {img_path.name}")
        
        # Compare
        matches = {}
        counted = {}
        extracted_vals = {}
        for field in FIELDS:
            match, ext_val, cnt = compare_values(gt.get(field), extracted.get(field))
            matches[field] = match
            counted[field] = cnt
            extracted_vals[field] = ext_val
        
        # Determine verdict: only consider fields that were counted (expected provided)
        critical_matches = (matches.get("amount") is True) and (matches.get("transaction_id") is True)
        if not critical_matches:
            verdict = "flagged"
        elif all(v is True for v in matches.values() if v is not None):
            verdict = "matches"
        else:
            verdict = "flagged"
        
        # Build result row
        def match_str(field):
            m = matches.get(field)
            c = counted.get(field)
            if not c:
                return "N/A"  # not provided by owner
            return "YES" if m is True else "NO"
        
        row = {
            "image": img_path.name,
            "app": extracted.get("app") or "",
            "expected_amount": gt.get("amount", ""),
            "extracted_amount": extracted_vals.get("amount", ""),
            "amount_match": match_str("amount"),
            "expected_txn_id": gt.get("transaction_id", ""),
            "extracted_txn_id": extracted_vals.get("transaction_id", ""),
            "txn_id_match": match_str("transaction_id"),
            "expected_date": gt.get("paid_at", ""),
            "extracted_date": extracted_vals.get("paid_at", ""),
            "date_match": match_str("paid_at"),
            "expected_receiver": gt.get("receiver_name", ""),
            "extracted_receiver": extracted_vals.get("receiver_name", ""),
            "receiver_match": match_str("receiver_name"),
            "expected_status": gt.get("status", ""),
            "extracted_status": extracted_vals.get("status", ""),
            "status_match": match_str("status"),
            "verdict": verdict
        }
        results.append(row)
        
        # Print summary
        print(f"  Verdict: {verdict}")
        for field in ["amount", "transaction_id", "paid_at", "receiver_name", "status"]:
            m = matches.get(field)
            c = counted.get(field)
            if not c:
                status = "N/A"
            else:
                status = "✓" if m is True else "✗"
            print(f"    {field}: {status} (expected: {gt.get(field)}, got: {extracted_vals.get(field)})")
    
    # Write CSV report
    with open(REPORT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS)
        writer.writeheader()
        writer.writerows(results)
    print(f"\nCSV report saved to: {REPORT_CSV}")
    
    # Generate summary
    total = len(results)
    if total == 0:
        print("No results to summarize.")
        return
    
    field_counts = {field: {"yes": 0, "no": 0, "na": 0} for field in ["amount", "transaction_id", "paid_at", "receiver_name", "status", "receiver_account"]}
    verdict_counts = {"matches": 0, "flagged": 0, "unreadable": 0}
    
    for row in results:
        verdict_counts[row["verdict"]] = verdict_counts.get(row["verdict"], 0) + 1
        for field in ["amount", "transaction_id", "paid_at", "receiver_name", "status"]:
            key = f"{field}_match"
            if row[key] == "YES":
                field_counts[field]["yes"] += 1
            elif row[key] == "NO":
                field_counts[field]["no"] += 1
            else:
                field_counts[field]["na"] += 1
    
    summary_lines = [
        "Step D Accuracy Summary",
        "=" * 50,
        f"Total screenshots tested: {total}",
        "",
        "Field Accuracy (only fields where owner provided ground truth):",
        "-" * 30,
    ]
    
    for field in ["amount", "transaction_id", "paid_at", "receiver_name", "status"]:
        yes = field_counts[field]["yes"]
        no = field_counts[field]["no"]
        na = field_counts[field]["na"]
        total_field = yes + no
        pct = (yes / total_field * 100) if total_field > 0 else 0
        summary_lines.append(f"  {field:20s}: {yes:3d}/{total_field:3d} ({pct:5.1f}%)  [N/A: {na}]")
    
    summary_lines.extend([
        "",
        "Verdict Distribution:",
        "-" * 30,
    ])
    for verdict, count in verdict_counts.items():
        if count > 0:
            pct = count / total * 100
            summary_lines.append(f"  {verdict:15s}: {count:3d} ({pct:5.1f}%)")
    
    summary_lines.extend([
        "",
        "NOTE: This measures OCR EXTRACTION ACCURACY only.",
        "A 'matches' verdict means the extracted text agrees with",
        "the ground truth. It does NOT verify transaction authenticity.",
        "Edited/fake screenshots can still extract correctly.",
    ])
    
    summary_text = "\n".join(summary_lines)
    print("\n" + summary_text)
    
    with open(SUMMARY_TXT, "w", encoding="utf-8") as f:
        f.write(summary_text)
    print(f"\nSummary saved to: {SUMMARY_TXT}")
    print(f"Ground truth saved to: {GROUND_TRUTH_FILE}")

if __name__ == "__main__":
    run_accuracy_test()