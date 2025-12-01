from config.service_config import ServiceConfig, BCEnvironment
from src.utils.business_central_auth import BusinessCentralAuth
from src.utils.logger import get_logger

logger = get_logger(__name__)
config = ServiceConfig()

# Global runtime BC environment (starts from config default)
CURRENT_BC_ENV: BCEnvironment = config.BC_ENV_NAME

def get_current_bc_env_value() -> str:
    """
    Returns the string value of the current BC environment, handling Enum types.
    """
    env = CURRENT_BC_ENV
    try:
        return env.value  # Enum with .value, e.g. "JotexTest"
    except AttributeError:
        return str(env)

def set_current_bc_env(env: BCEnvironment) -> None:
    """
    Update the global BC environment.
    """
    global CURRENT_BC_ENV
    CURRENT_BC_ENV = env
    logger.info(f"Updated global Business Central environment to: {get_current_bc_env_value()}")

def get_bc_auth() -> BusinessCentralAuth:
    """
    Factory to create a BusinessCentralAuth using the current global BC environment.
    """
    env_value = get_current_bc_env_value()
    logger.info(f"Using Business Central environment: {env_value}")
    return BusinessCentralAuth(
        tenant_id=config.TENANT_ID.get_secret_value(),
        client_id=config.CLIENT_ID.get_secret_value(),
        client_secret=config.CLIENT_SECRET.get_secret_value(),
        azure_bc_env_name=env_value,
    )
