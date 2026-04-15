import os
import requests
import base64
import json
import datetime

API_KEY = os.environ.get("ENTRATA_API_KEY")
PROPERTY_ID = int(os.environ.get("ENTRATA_PROPERTY_ID", "100135280"))
ORG_SLUG = os.environ.get("ENTRATA_ORG_SLUG", "redstoneresidential")

def test_entrata_sync():
    if not API_KEY:
        raise RuntimeError("Set ENTRATA_API_KEY before running this script.")

    print(f"Testing Entrata Sync for Property {PROPERTY_ID}...")
    
    # Matching the working cURL exactly
    url = f"https://apis.entrata.com/ext/orgs/{ORG_SLUG}/v1/leads?page_no=1&per_page=500"
    
    auth_str = base64.b64encode(f"X-Api-Key:{API_KEY}".encode()).decode()
    
    headers = {
        "Content-Type": "APPLICATION/JSON; CHARSET=UTF-8",
        "X-Api-Key": API_KEY,
        "X-Send-pagination-Links": "1",
        "Authorization": f"Basic {auth_str}",
        "User-Agent": "PostmanRuntime/7.39.1",
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive"
    }
    
    today_str = datetime.datetime.now().strftime("%m/%d/%Y")
    
    payload = {
        "auth": {"type": "apikey"},
        "requestId": "15",
        "method": {
            "name": "getLeads",
            "version": "r1",
            "params": {
                "propertyId": PROPERTY_ID,
                "includeDemographics": "0",
                "fromDate": today_str,
                "toDate": today_str,
                "excludeAmenities": "0"
            }
        }
    }
    
    print(f"Sending request to {url}...")
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        print(f"Status Code: {response.status_code}")
        print(f"Response Body: {response.text}")
        
        if response.status_code == 200:
            print("\nSUCCESS! The code works in your current environment.")
            print("This confirms that the Cloud Function failure is due to Entrata-side restrictions (IP Whitelist or Application Association).")
        else:
            print("\nFAILURE. Please check your API Key and Organizational Slug.")
            
    except Exception as e:
        print(f"Error making request: {str(e)}")

if __name__ == "__main__":
    test_entrata_sync()
