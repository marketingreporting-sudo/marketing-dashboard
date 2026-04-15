import os
import datetime
import requests
from bs4 import BeautifulSoup
import firebase_admin
from firebase_admin import credentials, firestore
from google.oauth2.credentials import Credentials
import json

FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "data-analysis-eeb4d")
SITE_AUDIT_BASE_URL = os.environ.get("SITE_AUDIT_BASE_URL", "https://livemontaireslc.com")

# Setup logic to handle both local and Cloud Function execution
def init_firestore(project_id=FIREBASE_PROJECT_ID):
    try:
        firebase_admin.get_app()
    except ValueError:
        # Check for local CLI credentials
        config_path = os.path.expanduser("~/.config/configstore/firebase-tools.json")
        if os.path.exists(config_path):
            with open(config_path, 'r') as f:
                config = json.load(f)
            tokens = config.get('tokens', {})
            creds = Credentials(
                token=tokens.get('access_token'),
                refresh_token=tokens.get('refresh_token'),
                token_uri="https://oauth2.googleapis.com/token",
                client_id="563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
                client_secret=None
            )
            return firestore.Client(project=project_id, credentials=creds)
        else:
            # Fallback to default credentials (works in Cloud Functions)
            firebase_admin.initialize_app()
            return firestore.client()

db = init_firestore()

BASE_URL = SITE_AUDIT_BASE_URL
INTERNAL_PAGES = [
    "/", "/amenities/", "/floor-plans/", "/gallery/", "/neighborhood/", "/faqs/", "/blog/", "/contact/"
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def perform_site_audit():
    audit_report = {
        "timestamp": firestore.SERVER_TIMESTAMP,
        "site": BASE_URL,
        "pages_audited": [],
        "broken_links": [],
        "missing_meta": [],
        "headline_optimizations": []
    }

    for path in INTERNAL_PAGES:
        url = BASE_URL + path
        try:
            response = requests.get(url, headers=HEADERS, timeout=15)
            page_data = {
                "url": url,
                "status_code": response.status_code,
                "has_meta_description": False,
                "h1": "",
                "title": ""
            }

            if response.status_code == 200:
                soup = BeautifulSoup(response.text, 'html.parser')
                
                # Check for meta description (Meta name or OG)
                meta_desc = soup.find("meta", attrs={"name": "description"}) or \
                            soup.find("meta", attrs={"property": "og:description"})
                if meta_desc and meta_desc.get("content"):
                    page_data["has_meta_description"] = True
                else:
                    audit_report["missing_meta"].append(url)

                # Extract H1
                h1 = soup.find("h1")
                page_data["h1"] = h1.text.strip() if h1 else "Missing H1"
                title = soup.find("title")
                page_data["title"] = title.text.strip() if title and title.text else ""

                # Quick check for internal broken links on this page
                links = soup.find_all("a", href=True)
                for link in links:
                    href = link["href"]
                    if href.startswith("/") or BASE_URL in href:
                        # We won't do a full recursive crawl here to keep the audit fast,
                        # but a production tool might.
                        if not href or href == "#":
                            audit_report["broken_links"].append({"source": url, "link": href, "reason": "Empty or anchor only"})

            else:
                audit_report["broken_links"].append({"source": "Navigation", "link": url, "reason": f"Status {response.status_code}"})

            audit_report["pages_audited"].append(page_data)

        except Exception as e:
            audit_report["broken_links"].append({"source": "Crawl", "link": url, "reason": str(e)})

    return audit_report

def save_audit(report):
    db.collection("site_audits").add(report)
    print(f"Audit completed and saved to Firestore for {BASE_URL}")

if __name__ == "__main__":
    report = perform_site_audit()
    save_audit(report)
