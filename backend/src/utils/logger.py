import logging
import logging.config
import yaml
from datetime import datetime
from pathlib import Path

def setup_logger(log_level="DEBUG", config_file=f"./config/logging.yaml", name: str = None):
    """
    Set up logging from a YAML configuration file.

    Args:
        log_level (str): Logging level to override root logger.
        config_file (str): Path to YAML logging config.
        name (str, optional): Logger name. Defaults to root logger.

    Returns:
        logging.Logger: Configured logger instance.
    """
    today = datetime.now().strftime('%Y-%m-%d')
    try:
        # Read YAML config as text to inject today's date into log filename
        with open(config_file, 'r', encoding='utf-8') as f:
            config_text = f.read()
        config_text = config_text.replace('%(date)s', today)
        config = yaml.safe_load(config_text)

        if log_level and "root" in config:
            config["root"]["level"] = log_level

        # Ensure log directory exists
        Path('logs').mkdir(exist_ok=True)
        logging.config.dictConfig(config)

        # Get logger instance (named or root)
        logger = logging.getLogger(name) if name else logging.getLogger()
        logger.info(f"Log files created with date: {today}")
        return logger

    except Exception as e:
        logging.basicConfig(level=logging.INFO)
        logger = logging.getLogger(name) if name else logging.getLogger()
        logger.error(f"Failed to load logging configuration: {e}")
        return logger

def get_logger(name: str = None):
    """
    Get a logger instance.

    Args:
        name (str, optional): Logger name. Defaults to root logger.

    Returns:
        logging.Logger: Logger instance.
    """
    return logging.getLogger(name)