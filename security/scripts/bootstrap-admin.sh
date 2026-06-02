#!/bin/bash

##############################################################################
# Bootstrap Admin User & Roles for Keycloak
#
# This script creates:
# 1. Realm roles: 'admin' and 'uploader'
# 2. Default admin user (username: admin, password: admin_default_password)
# 3. Assigns 'admin' role to the admin user
# 4. Sets 'uploader' as default role for new users
#
# Usage:
#   bash security/scripts/bootstrap-admin.sh
#
# The script reads environment variables or uses defaults:
#   KEYCLOAK_ADMIN_URL          (default: http://keycloak:8080)
#   KEYCLOAK_REALM              (default: drm-realm)
#   KEYCLOAK_ADMIN_USER         (default: admin)
#   KEYCLOAK_ADMIN_PASSWORD     (from .env or KC_BOOTSTRAP_ADMIN_PASSWORD)
#   KEYCLOAK_CLIENT_ID          (default: backend-api)
#   KEYCLOAK_SECRET             (required for service-to-service calls)
#
##############################################################################

set -e

# ── Configuration ──────────────────────────────────────────────────────────
KEYCLOAK_ADMIN_URL="${KEYCLOAK_ADMIN_URL:-http://keycloak:8080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-drm-realm}"
KEYCLOAK_ADMIN_USER="${KEYCLOAK_ADMIN_USER:-admin}"
KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-${KC_BOOTSTRAP_ADMIN_PASSWORD}}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-backend-api}"
KEYCLOAK_SECRET="${KEYCLOAK_SECRET}"

# Default credentials for the default admin user
DEFAULT_ADMIN_USER="admin"
DEFAULT_ADMIN_PASSWORD="admin_default_password"

# ── Validation ─────────────────────────────────────────────────────────────
if [[ -z "$KEYCLOAK_ADMIN_PASSWORD" ]]; then
  echo "❌ Error: KEYCLOAK_ADMIN_PASSWORD not set"
  echo "   Set KC_BOOTSTRAP_ADMIN_PASSWORD in .env or pass KEYCLOAK_ADMIN_PASSWORD env var"
  exit 1
fi

if [[ -z "$KEYCLOAK_SECRET" ]]; then
  echo "❌ Error: KEYCLOAK_SECRET not set"
  echo "   Set KEYCLOAK_SECRET in .env"
  exit 1
fi

# ── Helper Functions ───────────────────────────────────────────────────────
log_info() {
  echo "ℹ️  $1"
}

log_success() {
  echo "✅ $1"
}

log_error() {
  echo "❌ $1"
}

# Wait for Keycloak to be ready
wait_for_keycloak() {
  local max_attempts=30
  local attempt=0

  log_info "Waiting for Keycloak at $KEYCLOAK_ADMIN_URL..."
  while [ $attempt -lt $max_attempts ]; do
    if curl -s "$KEYCLOAK_ADMIN_URL/admin/realms/$KEYCLOAK_REALM" > /dev/null 2>&1; then
      log_success "Keycloak is ready"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 2
  done

  log_error "Keycloak did not become ready after $((max_attempts * 2)) seconds"
  exit 1
}

# Get admin token for service-to-service calls
get_admin_token() {
  local token_url="$KEYCLOAK_ADMIN_URL/realms/$KEYCLOAK_REALM/protocol/openid-connect/token"

  log_info "Getting admin token..."

  local response=$(curl -s -X POST "$token_url" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=client_credentials" \
    -d "client_id=$KEYCLOAK_CLIENT_ID" \
    -d "client_secret=$KEYCLOAK_SECRET")

  local token=$(echo "$response" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

  if [[ -z "$token" ]]; then
    log_error "Failed to get admin token"
    echo "Response: $response"
    exit 1
  fi

  echo "$token"
}

# Create a realm role if it doesn't exist
create_role() {
  local admin_token=$1
  local role_name=$2

  log_info "Checking role: $role_name"

  local role_check=$(curl -s -X GET \
    "$KEYCLOAK_ADMIN_URL/admin/realms/$KEYCLOAK_REALM/roles/$role_name" \
    -H "Authorization: Bearer $admin_token" 2>&1)

  # If role exists (HTTP 200), we're done
  if echo "$role_check" | grep -q '"name":"'$role_name'"'; then
    log_success "Role '$role_name' already exists"
    return 0
  fi

  log_info "Creating role: $role_name"

  local create_response=$(curl -s -X POST \
    "$KEYCLOAK_ADMIN_URL/admin/realms/$KEYCLOAK_REALM/roles" \
    -H "Authorization: Bearer $admin_token" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$role_name\",\"description\":\"Role for $role_name\"}")

  if echo "$create_response" | grep -q '"name":"'$role_name'"'; then
    log_success "Role '$role_name' created"
  elif echo "$create_response" | grep -q '"errorMessage".*"already exists"'; then
    log_success "Role '$role_name' already exists (conflict response)"
  else
    log_error "Failed to create role '$role_name'"
    echo "Response: $create_response"
    exit 1
  fi
}

# Create a user if it doesn't exist
create_user() {
  local admin_token=$1
  local username=$2
  local password=$3
  local first_name=${4:-$username}
  local last_name=${5:-Admin}

  log_info "Checking user: $username"

  # Check if user exists
  local user_check=$(curl -s -X GET \
    "$KEYCLOAK_ADMIN_URL/admin/realms/$KEYCLOAK_REALM/users?username=$username&exact=true" \
    -H "Authorization: Bearer $admin_token")

  if echo "$user_check" | grep -q '"username":"'$username'"'; then
    log_success "User '$username' already exists"
    # Extract user ID for later role assignment
    echo "$user_check" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4
    return 0
  fi

  log_info "Creating user: $username"

  local create_response=$(curl -s -X POST \
    "$KEYCLOAK_ADMIN_URL/admin/realms/$KEYCLOAK_REALM/users" \
    -H "Authorization: Bearer $admin_token" \
    -H "Content-Type: application/json" \
    -d "{
      \"username\":\"$username\",
      \"email\":\"${username}@system.local\",
      \"firstName\":\"$first_name\",
      \"lastName\":\"$last_name\",
      \"enabled\":true,
      \"emailVerified\":true,
      \"credentials\":[{\"type\":\"password\",\"value\":\"$password\",\"temporary\":false}]
    }")

  if echo "$create_response" | grep -q "201"; then
    log_success "User '$username' created"
    # Get the user ID from the response headers (Location: .../{id})
    # Or query the user to get ID
    local user_id=$(curl -s -X GET \
      "$KEYCLOAK_ADMIN_URL/admin/realms/$KEYCLOAK_REALM/users?username=$username&exact=true" \
      -H "Authorization: Bearer $admin_token" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)
    echo "$user_id"
  elif echo "$create_response" | grep -q '"error".*"409"'; then
    log_success "User '$username' already exists (conflict response)"
    local user_id=$(curl -s -X GET \
      "$KEYCLOAK_ADMIN_URL/admin/realms/$KEYCLOAK_REALM/users?username=$username&exact=true" \
      -H "Authorization: Bearer $admin_token" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)
    echo "$user_id"
  else
    log_error "Failed to create user '$username'"
    echo "Response: $create_response"
    exit 1
  fi
}

# Assign a realm role to a user
assign_role() {
  local admin_token=$1
  local user_id=$2
  local role_name=$3

  log_info "Assigning role '$role_name' to user (ID: $user_id)"

  # First get the role ID
  local role_id=$(curl -s -X GET \
    "$KEYCLOAK_ADMIN_URL/admin/realms/$KEYCLOAK_REALM/roles/$role_name" \
    -H "Authorization: Bearer $admin_token" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

  if [[ -z "$role_id" ]]; then
    log_error "Could not find role ID for '$role_name'"
    exit 1
  fi

  # Check if role is already assigned
  local current_roles=$(curl -s -X GET \
    "$KEYCLOAK_ADMIN_URL/admin/realms/$KEYCLOAK_REALM/users/$user_id/role-mappings/realm" \
    -H "Authorization: Bearer $admin_token")

  if echo "$current_roles" | grep -q "\"name\":\"$role_name\""; then
    log_success "Role '$role_name' already assigned to user"
    return 0
  fi

  # Assign the role
  local assign_response=$(curl -s -X POST \
    "$KEYCLOAK_ADMIN_URL/admin/realms/$KEYCLOAK_REALM/users/$user_id/role-mappings/realm" \
    -H "Authorization: Bearer $admin_token" \
    -H "Content-Type: application/json" \
    -d "[{\"id\":\"$role_id\",\"name\":\"$role_name\",\"composite\":false,\"clientRole\":false,\"containerId\":\"$KEYCLOAK_REALM\"}]")

  if [[ -z "$assign_response" ]] || echo "$assign_response" | grep -qv '"error"'; then
    log_success "Role '$role_name' assigned to user"
  else
    log_error "Failed to assign role '$role_name' to user"
    echo "Response: $assign_response"
    exit 1
  fi
}

# ── Main Execution ────────────────────────────────────────────────────────────
main() {
  log_info "=== Bootstrapping Keycloak Realm: $KEYCLOAK_REALM ==="
  log_info "Keycloak URL: $KEYCLOAK_ADMIN_URL"

  # Step 1: Wait for Keycloak
  wait_for_keycloak

  # Step 2: Get admin token
  local admin_token=$(get_admin_token)
  log_success "Admin token obtained"

  # Step 3: Create realm roles
  create_role "$admin_token" "admin"
  create_role "$admin_token" "uploader"

  # Step 4: Create default admin user
  local admin_user_id=$(create_user "$admin_token" "$DEFAULT_ADMIN_USER" "$DEFAULT_ADMIN_PASSWORD" "Admin" "System")

  if [[ -z "$admin_user_id" ]]; then
    log_error "Failed to get admin user ID"
    exit 1
  fi

  log_success "Admin user ID: $admin_user_id"

  # Step 5: Assign admin role to admin user
  assign_role "$admin_token" "$admin_user_id" "admin"

  # Step 6: Assign uploader role to admin user (admin should also be able to upload)
  assign_role "$admin_token" "$admin_user_id" "uploader"

  # ── Success ────────────────────────────────────────────────────────────
  log_info ""
  log_success "=== Bootstrap Complete ==="
  log_info "Default admin user created:"
  log_info "  Username: $DEFAULT_ADMIN_USER"
  log_info "  Password: $DEFAULT_ADMIN_PASSWORD"
  log_info ""
  log_info "⚠️  IMPORTANT: Change the default admin password immediately after first login!"
  log_info ""
}

# ── Run Main ───────────────────────────────────────────────────────────────
main "$@"
