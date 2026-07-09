#!/usr/bin/env python3
import sys
import os
import json
import urllib.request
import urllib.parse

# Configurations
API_URL = os.environ.get("KORTEX_API_URL", "http://localhost:5000/api/integration")
API_KEY = os.environ.get("KORTEX_API_KEY", "kt_live_kortex_key_fallback_2026")

def api_request(path, data=None, method="GET"):
    headers = {
        "x-api-key": API_KEY,
        "Content-Type": "application/json",
        "User-Agent": "KortexCLI/1.0"
    }
    
    url = f"{API_URL}{path}"
    req_body = json.dumps(data).encode("utf-8") if data else None
    
    req = urllib.request.Request(url, data=req_body, headers=headers, method=method)
    
    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"Error: HTTP {e.code} - {e.reason}", file=sys.stderr)
        try:
            err_details = json.loads(e.read().decode("utf-8"))
            print(f"Details: {err_details.get('error')}", file=sys.stderr)
        except Exception:
            pass
        sys.exit(1)
    except Exception as e:
        print(f"Failed to connect to Kortex API: {e}", file=sys.stderr)
        sys.exit(1)

def print_help():
    print("""Kortex CLI - Developer & Agent Integration Core
Usage:
  python kortex.py context                  Show today's tasks, goals, WFH/office mode, and active memories
  python kortex.py add "<task text>"        Create a task using NLP (e.g. 'check kubernetes nodes by 4pm, high priority')
  python kortex.py complete <id> [mins]     Mark a task completed with optional actual duration and resolution
                            "<resolution>"
  python kortex.py remember "<fact>"        Ingest SRE commands, runbooks, or notes directly to memory
  python kortex.py standup                  Retrieve your daily status report for Slack/Teams

Environment Variables:
  KORTEX_API_URL   Default: http://localhost:5000/api/integration
  KORTEX_API_KEY   Your permanent API key generated in Kortex Settings
""")

def main():
    if len(sys.argv) < 2:
        print_help()
        sys.exit(0)
        
    cmd = sys.argv[1].lower()
    
    if cmd == "help":
        print_help()
        
    elif cmd == "context":
        data = api_request("/context")
        print(json.dumps(data, indent=2))
        
    elif cmd == "add":
        if len(sys.argv) < 3:
            print("Error: Provide the task description string.", file=sys.stderr)
            sys.exit(1)
        text = sys.argv[2]
        res = api_request("/task", {"text": text}, "POST")
        print(f"Created task: \"{res.get('title')}\" [ID: {res.get('_id')}]")
        
    elif cmd == "complete":
        if len(sys.argv) < 3:
            print("Error: Provide task ID. Format: complete <id> [duration_mins] [resolution_notes]", file=sys.stderr)
            sys.exit(1)
            
        task_id = sys.argv[2]
        duration = 30
        resolution = "Completed via Kortex CLI client."
        
        if len(sys.argv) == 4:
            # check if arg is number or text
            try:
                duration = int(sys.argv[3])
            except ValueError:
                resolution = sys.argv[3]
        elif len(sys.argv) >= 5:
            duration = int(sys.argv[3])
            resolution = sys.argv[4]
            
        res = api_request(f"/task/{task_id}/complete", {"actualTime": duration, "resolution": resolution}, "POST")
        print(res.get("message", "Task finalized."))
        
    elif cmd == "remember":
        if len(sys.argv) < 3:
            print("Error: Provide the memory content string.", file=sys.stderr)
            sys.exit(1)
        content = sys.argv[2]
        res = api_request("/memory", {"content": content, "category": "SRE Command"}, "POST")
        print(f"Stored long-term memory synapse [ID: {res.get('_id')}]")
        
    elif cmd == "standup":
        res = api_request("/standup")
        print(res.get("standup"))
        
    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        print_help()
        sys.exit(1)

if __name__ == "__main__":
    main()
