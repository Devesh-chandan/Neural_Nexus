import os
import glob
import re

store_dir = r"d:\mindspark\Neural_Nexus\Neural_Nexus\backend\app\store"
files = glob.glob(os.path.join(store_dir, "*.py"))

for fpath in files:
    if fpath.endswith("db.py"): continue
    
    with open(fpath, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Replace ? with %s for SQL parameters
    content = content.replace("?", "%s")
    
    # Replace INSERT OR REPLACE in runs.py
    if "runs.py" in fpath:
        content = content.replace(
            "INSERT OR REPLACE INTO runs\n            (run_id, case_id, product_json, metrics_json, suitability_json,\n             explanation_json, data_source, as_of, snapshot_id, created_at)\n            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            "INSERT INTO runs\n            (run_id, case_id, product_json, metrics_json, suitability_json,\n             explanation_json, data_source, as_of, snapshot_id, created_at)\n            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)\n            ON CONFLICT (run_id) DO UPDATE SET\n            case_id=EXCLUDED.case_id,\n            product_json=EXCLUDED.product_json,\n            metrics_json=EXCLUDED.metrics_json,\n            suitability_json=EXCLUDED.suitability_json,\n            explanation_json=EXCLUDED.explanation_json,\n            data_source=EXCLUDED.data_source,\n            as_of=EXCLUDED.as_of,\n            snapshot_id=EXCLUDED.snapshot_id,\n            created_at=EXCLUDED.created_at"
        )

    # Replace INSERT OR REPLACE in rms.py
    if "rms.py" in fpath:
        content = content.replace(
            "INSERT OR REPLACE INTO run_finalisations",
            "INSERT INTO run_finalisations (run_id, rm_id, allowed, access_tier, reason, finalised_at) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (run_id) DO UPDATE SET rm_id=EXCLUDED.rm_id, allowed=EXCLUDED.allowed, access_tier=EXCLUDED.access_tier, reason=EXCLUDED.reason, finalised_at=EXCLUDED.finalised_at --"
        )
        content = content.replace(
            "(run_id, rm_id, allowed, access_tier, reason, finalised_at)\n                VALUES (%s, %s, %s, %s, %s, %s)",
            ""
        )
        
    with open(fpath, "w", encoding="utf-8") as f:
        f.write(content)

print("Migration script completed.")
