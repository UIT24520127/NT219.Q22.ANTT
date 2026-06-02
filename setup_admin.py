#!/usr/bin/env python3
"""
Setup admin user in Keycloak
Usage: python setup_admin.py
"""

import requests
import sys
import time

KEYCLOAK_HOST = "http://localhost:8080"
REALM = "drm-realm"
USERNAME = "admin"
PASSWORD = "Admin@2006"
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin"

def wait_for_keycloak(max_retries=60):
    """Wait for Keycloak to be ready"""
    for i in range(max_retries):
        try:
            response = requests.get(f"{KEYCLOAK_HOST}/health/ready", timeout=2)
            if response.status_code == 200:
                print("✅ Keycloak ready")
                return True
        except requests.exceptions.RequestException:
            pass
        
        if i < max_retries - 1:
            print(f"  Trying {i+1}/{max_retries}...")
            time.sleep(2)
    
    print("❌ Keycloak timeout")
    return False

def get_admin_token():
    """Get admin token from Keycloak"""
    print("🔑 Getting admin token...")
    
    url = f"{KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token"
    data = {
        "grant_type": "password",
        "client_id": "admin-cli",
        "username": ADMIN_USERNAME,
        "password": ADMIN_PASSWORD,
    }
    
    try:
        response = requests.post(url, data=data, timeout=5)
        if response.status_code == 200:
            token = response.json().get("access_token")
            if token:
                print("✅ Admin token acquired")
                return token
    except Exception as e:
        print(f"❌ Error getting token: {e}")
    
    return None

def user_exists(admin_token):
    """Check if user exists"""
    print(f"🔍 Checking if user '{USERNAME}' exists...")
    
    url = f"{KEYCLOAK_HOST}/admin/realms/{REALM}/users?username={USERNAME}"
    headers = {"Authorization": f"Bearer {admin_token}"}
    
    try:
        response = requests.get(url, headers=headers, timeout=5)
        if response.status_code == 200:
            users = response.json()
            return users[0] if users else None
    except Exception as e:
        print(f"❌ Error checking user: {e}")
    
    return None

def create_user(admin_token):
    """Create new admin user"""
    print(f"✨ Creating user '{USERNAME}'...")
    
    url = f"{KEYCLOAK_HOST}/admin/realms/{REALM}/users"
    headers = {
        "Authorization": f"Bearer {admin_token}",
        "Content-Type": "application/json",
    }
    data = {
        "username": USERNAME,
        "email": "admin@drm-system.local",
        "enabled": True,
        "credentials": [
            {
                "type": "password",
                "value": PASSWORD,
                "temporary": False,
            }
        ],
    }
    
    try:
        response = requests.post(url, json=data, headers=headers, timeout=5)
        if response.status_code in (201, 204):
            print(f"✅ User '{USERNAME}' created")
            return True
        else:
            print(f"❌ Failed to create user: {response.status_code}")
            print(response.text)
            return False
    except Exception as e:
        print(f"❌ Error creating user: {e}")
        return False

def reset_password(admin_token, user_id):
    """Reset password for existing user"""
    print(f"🔐 Resetting password for user '{USERNAME}'...")
    
    url = f"{KEYCLOAK_HOST}/admin/realms/{REALM}/users/{user_id}/reset-password"
    headers = {
        "Authorization": f"Bearer {admin_token}",
        "Content-Type": "application/json",
    }
    data = {
        "type": "password",
        "value": PASSWORD,
        "temporary": False,
    }
    
    try:
        response = requests.put(url, json=data, headers=headers, timeout=5)
        if response.status_code in (200, 204):
            print(f"✅ Password reset for user '{USERNAME}'")
            return True
        else:
            print(f"❌ Failed to reset password: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Error resetting password: {e}")
        return False

def main():
    print("🚀 Setting up admin user in Keycloak...")
    print()
    
    # Wait for Keycloak
    if not wait_for_keycloak():
        sys.exit(1)
    
    # Get admin token
    admin_token = get_admin_token()
    if not admin_token:
        sys.exit(1)
    
    # Check if user exists
    existing_user = user_exists(admin_token)
    
    if existing_user:
        print(f"ℹ️  User already exists (ID: {existing_user['id']})")
        # Reset password
        if reset_password(admin_token, existing_user["id"]):
            print()
            print(f"✅ Admin setup complete!")
            print(f"📝 Credentials: {USERNAME} / {PASSWORD}")
    else:
        # Create new user
        if create_user(admin_token):
            print()
            print(f"✅ Admin setup complete!")
            print(f"📝 Credentials: {USERNAME} / {PASSWORD}")
        else:
            sys.exit(1)

if __name__ == "__main__":
    main()
