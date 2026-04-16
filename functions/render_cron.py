from __future__ import annotations

import argparse
import json
import sys

from render_runtime import install_render_storage_overrides, run_named_cron_job


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a named Render cron job.")
    parser.add_argument("job_name", help="Cron job name from render_adapter_registry.py")
    args = parser.parse_args()

    install_render_storage_overrides()

    try:
        result = run_named_cron_job(args.job_name)
    except Exception as exc:
        print(json.dumps({"status": "error", "job_name": args.job_name, "error": str(exc)}, default=str))
        return 1

    print(json.dumps(result, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
