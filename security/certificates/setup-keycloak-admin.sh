#!/bin/bash
# setup-keycloak-admin.sh
# Thiết lập password admin trong Keycloak qua API

set -e

KEYCLOAK_HOST="${KEYCLOAK_HOST:-keycloak:8080}"
REALM="drm-realm"
USERNAME="admin"
PASSWORD="Admin@2006"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD="${KC_ADMIN_PASSWORD:-admin}"

echo "⏳ Chờ Keycloak sẵn sàng (${KEYCLOAK_HOST})..."

# Retry logic to wait for Keycloak
i=1
while [ $i -le 60 ]; do
  if curl -sf http://${KEYCLOAK_HOST}/health/ready > /dev/null 2>&1; then
    echo "✅ Keycloak sẵn sàng"
    break
  fi
  if [ $i -eq 60 ]; then
    echo "❌ Keycloak timeout"
    exit 1
  fi
  echo "  Lần thử $i/60..."
  sleep 2
  i=$((i + 1))
done

echo "🔑 Lấy admin token..."

# Get admin token for master realm
ADMIN_TOKEN=$(curl -s -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=$ADMIN_USERNAME" \
  -d "password=$ADMIN_PASSWORD" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" \
  http://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token 2>/dev/null | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

if [ -z "$ADMIN_TOKEN" ]; then
  echo "❌ Không thể lấy admin token"
  echo "Debug: check Keycloak response"
  curl -s -X POST \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=$ADMIN_USERNAME" \
    -d "password=$ADMIN_PASSWORD" \
    -d "grant_type=password" \
    -d "client_id=admin-cli" \
    http://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token
  exit 1
fi

echo "✅ Admin token acquired"

# Get user ID by username
echo "🔍 Tìm user '$USERNAME' trong realm '$REALM'..."

USER_RESPONSE=$(curl -s \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://${KEYCLOAK_HOST}/admin/realms/$REALM/users?username=$USERNAME 2>/dev/null)

USER_ID=$(echo "$USER_RESPONSE" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ -z "$USER_ID" ]; then
  echo "⚠️  User '$USERNAME' không tồn tại, tạo mới..."
  
  # Create user
  CREATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"username\": \"$USERNAME\",
      \"email\": \"admin@drm-system.local\",
      \"enabled\": true,
      \"credentials\": [{
        \"type\": \"password\",
        \"value\": \"$PASSWORD\",
        \"temporary\": false
      }]
    }" \
    http://${KEYCLOAK_HOST}/admin/realms/$REALM/users 2>/dev/null)
  
  HTTP_CODE=$(echo "$CREATE_RESPONSE" | tail -1)
  
  if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "204" ]; then
    echo "✅ User '$USERNAME' created successfully"
    echo "📝 Credentials: $USERNAME / $PASSWORD"
  else
    echo "❌ Failed to create user. HTTP $HTTP_CODE"
    echo "$CREATE_RESPONSE"
    exit 1
  fi
else
  echo "✅ Tìm thấy user: $USER_ID"
  
  # Reset password
  echo "🔐 Thiết lập mật khẩu..."
  
  curl -s -X PUT \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"type\": \"password\", \"value\": \"$PASSWORD\", \"temporary\": false}" \
    http://${KEYCLOAK_HOST}/admin/realms/$REALM/users/$USER_ID/reset-password 2>/dev/null
  
  echo "✅ Admin password thiết lập thành công!"
  echo "📝 Credentials: $USERNAME / $PASSWORD"
fi
