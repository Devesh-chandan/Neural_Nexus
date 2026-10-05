"""Batch-run the suitability rules over every client against one replay output.

    python -m scripts.run_assessment_batch --sim path/to/simulation_output.json
    python -m scripts.run_assessment_batch --sim sim.json --clients path/to/clients.json --out suitability_outputs
"""
import argparse
import json
import os
from pathlib import Path

from app.assessment.rules_engine import SuitabilityEngine

_HERE = Path(__file__).resolve().parent
_DEFAULT_CLIENTS = _HERE.parents[1] / "clients_india.json"


def process_all_clients(clients_path, sim_path, output_dir):
    # 1. Load Client Database & Simulation Data
    with open(clients_path, "r", encoding="utf-8") as f:
        clients = json.load(f)

    with open(sim_path, "r", encoding="utf-8") as f:
        sim_results = json.load(f)

    # 2. Prepare Output Directory
    os.makedirs(output_dir, exist_ok=True)

    engine = SuitabilityEngine()
    summary_report = []

    print(f"--- Running the suitability engine on {len(clients)} clients ---\n")

    # 3. Batch Evaluation Loop
    for client in clients:
        client_id = client["client_id"]

        # Calculate suitability payload
        assessment = engine.run_assessment(client, sim_results)

        # Save individual client JSON contract file
        filename = os.path.join(output_dir, f"suitability_{client_id}.json")
        with open(filename, "w", encoding="utf-8") as f:
            json.dump(assessment, f, indent=2)

        summary_report.append({
            "client_id": client_id,
            "overall_status": assessment["overall_status"],
            "risk_appetite": assessment["checks"]["risk_appetite"]["status"],
            "horizon": assessment["checks"]["investment_horizon"]["status"],
            "loss_tolerance": assessment["checks"]["loss_tolerance"]["status"],
            "concentration": assessment["checks"]["concentration_risk"]["status"]
        })

    # 4. Save Master Summary JSON
    summary_path = os.path.join(output_dir, "batch_summary_report.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary_report, f, indent=2)

    print(f"[OK] Generated {len(clients)} JSON files in '{output_dir}/'")
    print(f"[OK] Master summary report saved as '{summary_path}'")
    return summary_report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run suitability over all clients.")
    parser.add_argument("--sim", required=True, help="Replay simulation output JSON (POST /api/simulate result).")
    parser.add_argument("--clients", default=str(_DEFAULT_CLIENTS), help="Client database JSON.")
    parser.add_argument("--out", default=str(_HERE.parent / "data" / "suitability_outputs"), help="Output directory.")
    args = parser.parse_args()
    process_all_clients(args.clients, args.sim, args.out)
