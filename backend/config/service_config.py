from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from enum import Enum

class BCEnvironment(str, Enum):
    TEST = "JotexTest"
    PRODUCTION = "Production"

class ServiceConfig(BaseSettings):
    """
    Application service configuration loaded from environment variables or defaults.
    """
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="allow")
    ENV: str = Field(default="dev", description="Environment: dev, staging, prod")
    LOG_LEVEL: str = Field(default="DEBUG", description="Logging level")
    LOG_CONFIG_FILE: str = Field(default=f"./config/logging.yaml",description="Path to logging config file")

    CLIENT_ID: SecretStr = Field(..., description="OAuth Client ID")
    CLIENT_SECRET: SecretStr = Field(..., description="OAuth Client Secret")
    TENANT_ID: SecretStr = Field(..., description="OAuth Tenant ID")
    ONEDRIVE_EMAIL: str = Field(..., description="OneDrive Email")
    
    BC_ENV_NAME: BCEnvironment = Field(..., description="Business Central Environment Name")
    ONEDRIVE_DIR_PATH: str = Field(default="Documents/PO_FABRICS", description="OneDrive Directory Path for PO Fabrics")

    OPENAI_API_KEY: SecretStr = Field(..., description="OpenAI API Key")
    OPENAI_MODEL_NAME: str = Field(default="gpt-4o", description="OpenAI Model Name")
