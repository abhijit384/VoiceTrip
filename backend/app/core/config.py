import os
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # App Settings
    APP_NAME: str = "Rime Realtime Voice Travel Assistant"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = True
    LOG_LEVEL: str = "INFO"
    BACKEND_HOST: str = "0.0.0.0"
    BACKEND_PORT: int = 8000
    FRONTEND_PORT: int = 5173

    # Rime TTS Configuration
    RIME_API_KEY: Optional[str] = None
    RIME_API_URL: str = "https://users.rime.ai/v1/rime-tts"
    RIME_MODEL_ID: str = "mist"
    RIME_SPEAKER: str = "amber"
    RIME_AUDIO_FORMAT: str = "mp3"
    RIME_SAMPLE_RATE: int = 24000
    RIME_SPEED_ALPHA: float = 1.0

    # LLM (Groq Free Tier)
    GROQ_API_KEY: Optional[str] = None
    GROQ_MODEL: str = "llama-3.3-70b-versatile"

    # STT (Deepgram)
    DEEPGRAM_API_KEY: Optional[str] = None
    DEEPGRAM_MODEL: str = "nova-2"
    DEEPGRAM_LANGUAGE: str = "en-US"

    # LiveKit Realtime
    LIVEKIT_URL: Optional[str] = None
    LIVEKIT_API_KEY: Optional[str] = None
    LIVEKIT_API_SECRET: Optional[str] = None

    # Supabase (Optional)
    SUPABASE_URL: Optional[str] = None
    SUPABASE_ANON_KEY: Optional[str] = None
    SUPABASE_SERVICE_ROLE_KEY: Optional[str] = None

    # Simulation / Tool Stress Test
    TOOL_ARTIFICIAL_DELAY_SECONDS: float = 5.0

    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
