import os
import time
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp.mcp_client import MCPClient
import requests

COGNITO_TOKEN_URL = os.getenv("COGNITO_TOKEN_URL")
COGNITO_CLIENT_ID = os.getenv("COGNITO_CLIENT_ID")
COGNITO_CLIENT_SECRET = os.getenv("COGNITO_CLIENT_SECRET")
COGNITO_SCOPE = os.getenv("COGNITO_SCOPE")

# Token cache with expiration
_token_cache = {
    "token": None,
    "expires_at": 0
}

def _get_access_token():
    """
    Make a POST request to the Cognito OAuth token URL using client credentials.
    Implements token caching to reduce M2M token requests.
    """
    current_time = time.time()
    
    # Return cached token if still valid (with 5-minute buffer)
    if (_token_cache["token"] and 
        current_time < _token_cache["expires_at"] - 300):
        return _token_cache["token"]
    
    # Request new token
    response = requests.post(
        COGNITO_TOKEN_URL,
        auth=(COGNITO_CLIENT_ID, COGNITO_CLIENT_SECRET),
        data={
            "grant_type": "client_credentials",
            "scope": COGNITO_SCOPE,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    
    token_data = response.json()
    access_token = token_data["access_token"]
    expires_in = token_data.get("expires_in", 3600)  # Default 1 hour
    
    # Cache the token
    _token_cache["token"] = access_token
    _token_cache["expires_at"] = current_time + expires_in
    
    return access_token


def get_streamable_http_mcp_client() -> MCPClient:
    """
    Returns an MCP Client for AgentCore Gateway compatible with Strands
    """
    gateway_url = os.getenv("GATEWAY_URL")
    if not gateway_url:
        raise RuntimeError("Missing required environment variable: GATEWAY_URL")
    access_token = _get_access_token()
    return MCPClient(lambda: streamablehttp_client(gateway_url, headers={"Authorization": f"Bearer {access_token}"}))