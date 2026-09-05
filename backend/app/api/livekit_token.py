import uuid
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from livekit.api import AccessToken, VideoGrants
from app.core.config import settings

logger = logging.getLogger("livekit-token")
router = APIRouter(prefix="/livekit", tags=["LiveKit"])


class TokenRequest(BaseModel):
    room_name: Optional[str] = "voicetrip-room"
    participant_name: Optional[str] = None


class TokenResponse(BaseModel):
    server_url: str
    participant_token: str
    token: str
    url: str
    room_name: str
    participant_identity: str
    is_livekit_configured: bool
    status: str
    error_detail: Optional[str] = None


class LiveKitHealthResponse(BaseModel):
    livekit_url_status: str
    livekit_api_key_status: str
    livekit_api_secret_status: str
    is_livekit_configured: bool
    configured_url: Optional[str] = None


@router.get("/health", response_model=LiveKitHealthResponse)
async def check_livekit_health():
    """Diagnostic endpoint to inspect LiveKit Cloud configuration status."""
    url = settings.LIVEKIT_URL or ""
    api_key = settings.LIVEKIT_API_KEY or ""
    api_secret = settings.LIVEKIT_API_SECRET or ""

    url_status = "missing"
    if url:
        if "your-livekit-project" in url or "placeholder" in url:
            url_status = "placeholder"
        elif url.startswith("wss://") or url.startswith("ws://"):
            url_status = "configured"
        else:
            url_status = "invalid_protocol"

    api_key_status = "configured" if (api_key and "your_livekit" not in api_key) else "missing"
    api_secret_status = "configured" if (api_secret and "your_livekit" not in api_secret) else "missing"

    is_ready = (url_status == "configured" and api_key_status == "configured" and api_secret_status == "configured")

    return LiveKitHealthResponse(
        livekit_url_status=url_status,
        livekit_api_key_status=api_key_status,
        livekit_api_secret_status=api_secret_status,
        is_livekit_configured=is_ready,
        configured_url=url if url_status == "configured" else None,
    )


@router.post("/token", response_model=TokenResponse)
async def generate_livekit_token(payload: TokenRequest = TokenRequest()):
    """
    Generate an ephemeral JWT access token for joining a LiveKit Cloud room.
    Returns HTTP 200 with server_url and participant_token.
    Protects LIVEKIT_API_SECRET on the backend.
    """
    identity = f"user_{uuid.uuid4().hex[:8]}"
    room_name = payload.room_name or "voicetrip-room"
    name = payload.participant_name or "Traveler"

    api_key = settings.LIVEKIT_API_KEY or "APIjXwScaF2CH7A"
    api_secret = settings.LIVEKIT_API_SECRET or "devsecret_32_characters_long_min_pad!"
    livekit_url = settings.LIVEKIT_URL or "wss://your-livekit-project.livekit.cloud"

    has_real_key = bool(settings.LIVEKIT_API_KEY and "your_livekit" not in settings.LIVEKIT_API_KEY)
    has_real_secret = bool(settings.LIVEKIT_API_SECRET and "your_livekit" not in settings.LIVEKIT_API_SECRET)
    has_real_url = bool(
        settings.LIVEKIT_URL
        and "your-livekit-project" not in settings.LIVEKIT_URL
        and (settings.LIVEKIT_URL.startswith("wss://") or settings.LIVEKIT_URL.startswith("ws://"))
    )

    is_configured = has_real_key and has_real_secret and has_real_url

    try:
        grant = VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=True,
            can_subscribe=True,
        )
        token = (
            AccessToken(api_key=api_key, api_secret=api_secret)
            .with_identity(identity)
            .with_name(name)
            .with_grants(grant)
            .to_jwt()
        )
        logger.info(f"Generated LiveKit participant token for {identity} in room {room_name} (configured={is_configured})")
        return TokenResponse(
            server_url=livekit_url,
            participant_token=token,
            token=token,
            url=livekit_url,
            room_name=room_name,
            participant_identity=identity,
            is_livekit_configured=is_configured,
            status="SUCCESS",
            error_detail=None if is_configured else "LIVEKIT_URL is placeholder or unconfigured in .env",
        )
    except Exception as e:
        logger.error(f"Error signing LiveKit token: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate LiveKit JWT: {str(e)}")


@router.get("/token", response_model=TokenResponse)
async def get_livekit_token(
    room_name: str = "voicetrip-room",
    participant_name: Optional[str] = "Traveler",
):
    """GET convenience wrapper for generating LiveKit token."""
    return await generate_livekit_token(
        TokenRequest(room_name=room_name, participant_name=participant_name)
    )
