from src.utils.logger import get_logger
from src.prompt_engineering.templates import SALES_ORDER_EXTRACTION_PROMPT
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.messages import HumanMessage, SystemMessage
from src.prompt_engineering.schemas.sales_order_schema import SalesOrderOutputFormat

logger = get_logger(__name__)

sales_order_parser = PydanticOutputParser(pydantic_object=SalesOrderOutputFormat)

def build_sales_order_extraction_prompt(image_base64: str) -> list:
    """
    Build a prompt for extracting sales order information from a customer image.

    Args:
        image_base64 (str): The image data in base64 format.

    Returns:
        list: A list containing the system prompt and a HumanMessage with the image in base64 format.
    """
    try:
        system_msg = SystemMessage(content=SALES_ORDER_EXTRACTION_PROMPT.format(
            format_instructions=sales_order_parser.get_format_instructions())
        )
        human_msg = HumanMessage(content=[
            {"type": "text", "text": "Here is the sales order image:"},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_base64}"}}
        ])
        return [system_msg, human_msg]
    except Exception as e:
        logger.error(f"Error building sales order extraction prompt: {e}")
        raise