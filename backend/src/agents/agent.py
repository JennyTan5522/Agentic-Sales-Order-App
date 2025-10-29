from langgraph.prebuilt import create_react_agent
from src.agents.tools import search_customers_by_name, search_product_items_by_name
from src.prompt_engineering.templates import CUSTOMER_SEARCH_PROMPT, PRODUCT_ITEM_SEARCH_PROMPT
from src.prompt_engineering.schemas.customer_schema import CustomerSearchResults
from src.prompt_engineering.schemas.product_item_schema import ProductItemSearchResults
from src.utils.logger import get_logger

logger = get_logger(__name__)

def build_customer_search_agent(llm):
    """
    Create an AgentExecutor for customer search.

    Args:
        llm: The language model instance to use for the agent.
        system_prompt_text (str): The system prompt template text.
        format_instructions (str): Format instructions for the prompt.

    Returns:
        An AgentExecutor configured for customer search.
    """
    try:
        agent = create_react_agent(
            model=llm,
            tools=[search_customers_by_name],
            prompt=CUSTOMER_SEARCH_PROMPT,
            response_format=CustomerSearchResults
        )
        return agent
    except Exception as e:
        logger.error(f"Error building customer search agent: {e}")
        raise

def build_product_item_search_agent(llm):
    """
    Create an AgentExecutor for product item search.

    Args:
        llm: The language model instance to use for the agent.

    Returns:
        An AgentExecutor configured for item search.
    """ 
    try:
        agent = create_react_agent(
            model=llm,
            tools=[search_product_items_by_name],
            prompt=PRODUCT_ITEM_SEARCH_PROMPT,
            response_format=ProductItemSearchResults
        )
        return agent
    except Exception as e:
        logger.error(f"Error building item search agent: {e}")
        raise
