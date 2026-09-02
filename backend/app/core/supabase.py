"""
Supabase Client Initialization (Backend)
Configured with SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY.
The Secret Key is strictly maintained on the server.
"""
import logging
from typing import Optional, Any
from app.core.config import settings

logger = logging.getLogger("supabase-client")


class SupabaseService:
    def __init__(self):
        self.url: Optional[str] = settings.SUPABASE_URL
        self.publishable_key: Optional[str] = settings.SUPABASE_PUBLISHABLE_KEY
        self.secret_key: Optional[str] = settings.SUPABASE_SECRET_KEY
        self.is_configured: bool = bool(
            self.url
            and self.publishable_key
            and "your_" not in (self.publishable_key or "")
        )

    def get_server_client(self) -> Optional[Any]:
        """
        Initializes server-side Supabase client using SUPABASE_SECRET_KEY
        for elevated database operations (e.g. conversation persistence, telemetry).
        """
        if not self.is_configured:
            return None
        try:
            from supabase import create_client
            key_to_use = self.secret_key or self.publishable_key
            if key_to_use and self.url:
                return create_client(self.url, key_to_use)
        except ImportError:
            logger.debug("supabase-py not installed; persistence operating in in-memory mode")
        except Exception as e:
            logger.error(f"Failed to initialize Supabase client: {e}")
        return None


supabase_service = SupabaseService()
