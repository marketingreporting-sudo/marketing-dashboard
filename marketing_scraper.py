import os
import datetime
import requests
from bs4 import BeautifulSoup
import firebase_admin
from firebase_admin import credentials, firestore

import json
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "data-analysis-eeb4d")

# Helper to load credentials from Firebase CLI config
def get_firebase_creds():
    config_path = os.path.expanduser("~/.config/configstore/firebase-tools.json")
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
        tokens = config.get('tokens', {})
        user = config.get('user', {})
        
        creds = Credentials(
            token=tokens.get('access_token'),
            refresh_token=tokens.get('refresh_token'),
            token_uri="https://oauth2.googleapis.com/token",
            client_id="563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
            client_secret=None
        )
        return creds
    except Exception as e:
        print(f"Warning: Could not load CLI credentials: {e}")
        return None

# Initialize Firestore
project_id = FIREBASE_PROJECT_ID
creds = get_firebase_creds()
if creds:
    # Use the credentials directly for Firestore client
    db = firestore.Client(project=project_id, credentials=creds)
else:
    # Fallback to default
    try:
        firebase_admin.get_app()
    except ValueError:
        firebase_admin.initialize_app(options={'projectId': project_id})
    db = firestore.client()

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9"
}

def scrape_reddit(subreddit, query):
    # Use the .json endpoint for much better reliability in a script
    url = f"https://www.reddit.com/r/{subreddit}/search.json?q={query}&restrict_sr=on&sort=new"
    
    try:
        response = requests.get(url, headers=HEADERS, timeout=15)
        response.raise_for_status()
        data = response.json()
        
        posts = data.get('data', {}).get('children', [])
        results = []
        
        for post in posts:
            pdata = post.get('data', {})
            title = pdata.get('title')
            permalink = pdata.get('permalink')
            created_utc = pdata.get('created_utc')
            
            if title and permalink:
                results.append({
                    "source": f"reddit_r_{subreddit}",
                    "query": query,
                    "title": title,
                    "url": f"https://www.reddit.com{permalink}",
                    "timestamp": datetime.datetime.fromtimestamp(created_utc).isoformat() if created_utc else "",
                    "scraped_at": firestore.SERVER_TIMESTAMP
                })
        return results
    except Exception as e:
        print(f"Error scraping Reddit r/{subreddit}: {e}")
        return []

def scrape_uta_schedule():
    url = "https://www.rideuta.com/Rider-Tools/Schedules-and-Maps/703-Red-Line"
    try:
        response = requests.get(url, headers=HEADERS, timeout=15)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        results = []
        
        # Pull station names
        stations = [s.text.strip() for s in soup.select("div.station-name") if s.text.strip()]
        
        # Note: The actual trip data is often hidden in a container that might be hard 
        # to parse with just BeautifulSoup if it's dynamic. 
        # For now, we'll store the stations and the metadata found.
        
        results.append({
            "source": "uta_trax_703",
            "type": "transit_metadata",
            "stations": stations,
            "stations_count": len(stations),
            "url": url,
            "scraped_at": firestore.SERVER_TIMESTAMP
        })
        return results
    except Exception as e:
        print(f"Error scraping UTA: {e}")
        return []

def save_to_firestore(collection_name, data):
    if not data:
        return
        
    batch = db.batch()
    col_ref = db.collection(collection_name)
    count = 0
    
    for item in data:
        doc_ref = col_ref.document()
        batch.set(doc_ref, item)
        count += 1
        if count >= 450:
            batch.commit()
            batch = db.batch()
            count = 0
    
    if count > 0:
        batch.commit()
        
    print(f"Saved {len(data)} items to {collection_name}")

if __name__ == "__main__":
    print("Starting Marketing Opportunities Scraper...")
    
    print("\n[1/3] Scraping Reddit r/uofu for 'events'...")
    uofu_events = scrape_reddit("uofu", "events")
    print(f"  -> Found {len(uofu_events)} events.")
    
    print("\n[2/3] Scraping Reddit r/SaltLakeCity for 'transportation'...")
    slc_transportation = scrape_reddit("SaltLakeCity", "transportation")
    print(f"  -> Found {len(slc_transportation)} transportation posts.")
    
    print("\n[3/3] Scraping UTA TRAX Red Line schedule...")
    uta_schedule = scrape_uta_schedule()
    print(f"  -> Extracted UTA schedule metadata.")
    
    all_opportunities = uofu_events + slc_transportation + uta_schedule
    
    if all_opportunities:
        print(f"\nSaving {len(all_opportunities)} total records to Firestore...")
        save_to_firestore("marketing_opportunities", all_opportunities)
        print("Success!")
    else:
        print("\nNo data found to save. Reddit might be blocking requests or selectors may be empty.")
