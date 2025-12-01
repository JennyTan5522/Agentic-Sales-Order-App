import requests
from src.utils.logger import get_logger
from langchain_core.tools import tool
from urllib.parse import quote
from src.utils.bc_env import get_bc_auth

bc_auth = get_bc_auth()
logger = get_logger(__name__)

@tool
def search_customers_by_name(company_name: str, customer_name_query: str, top_k: int = 5) -> str:
    """
    Search Business Central customers for the specified company. Matches records whose display_name contains the query string (case-insensitive). 
    Returns at most top_k results, each with customer_no and display_name.

    Args:
        company_name (str): The name of the company to search within.
        customer_name_query (str): Partial or full customer name to search for.
        top_k (int, optional): Maximum number of results to return (default is 5).

    Returns:
        str: A formatted string listing matching customers, or an error/message if none found.
    """
    try:
        if not customer_name_query or not customer_name_query.strip():
            return "Please provide a non-empty customer name query."
        
        company_id = bc_auth.get_company_id(company_name=company_name)
        filter_expr = f"contains(displayName,'{quote(customer_name_query)}')"

        endpoint = (
            f"{bc_auth.rest_api_base_url}/companies({company_id})/customers"
            f"?$filter={filter_expr}"
            f"&$top={int(top_k)}"
        )
        headers = {"Authorization": f"Bearer {bc_auth.get_access_token()}"}
        response = requests.get(endpoint, headers=headers)
        if response.status_code == 200:
            customers = response.json().get("value", [])
            if not customers:
                return "No customers found matching your query."
            logger.info(f"Found {len(customers)} customers matching '{customer_name_query}'")

            customer_info = []

            for customer in customers:
                logger.info(f" - {customer['number']}: {customer['displayName']}")
                customer_info.append(f"number: {customer.get('number', 'N/A')}, displayName: {customer.get('displayName', 'N/A')}, addressLine1: {customer.get('addressLine1', 'N/A')}, addressLine2: {customer.get('addressLine2', 'N/A')}, city: {customer.get('city', 'N/A')}, state: {customer.get('state', 'N/A')}, country: {customer.get('country', 'N/A')}, postalCode: {customer.get('postalCode', 'N/A')}, phoneNumber: {customer.get('phoneNumber', 'N/A')}, email: {customer.get('email', 'N/A')}")

            return "\n".join(customer_info)
        else:
            return f"API error: {response.status_code} - {response.text}"
    except Exception as e:
        logger.error(f"Exception in search_customers_by_name: {e}")
        return f"An error occurred while searching for customers: {e}"
    
@tool
def search_product_items_by_name(company_name: str, item_name_query: str, item_category: str, top_k: int = 5) -> str:
    """
    Search Business Central items for the specified company. Matches records whose display_name contains the query string (case-insensitive). 
    Returns at most top_k results, each with item_no and display_name.

    Args:
        company_name (str): The name of the company to search within.
        item_name_query (str): Partial or full item name to search for.
        item_category (str): The category of the item to filter results.
        top_k (int, optional): Maximum number of results to return (default is 5).

    Returns:
        str: A formatted string listing matching items, or an error/message if none found.
    """
    try:
        if not item_name_query or not item_name_query.strip():
            return "Please provide a non-empty item name query."

        company_id = bc_auth.get_company_id(company_name=company_name)
        filter_expr = f"itemCategoryCode eq '{quote(item_category)}' AND contains(displayName,'{quote(item_name_query)}')"

        endpoint = (
            f"{bc_auth.rest_api_base_url}/companies({company_id})/items"
            f"?$filter={filter_expr}"
            f"&$top={int(top_k)}"
        )

        headers = {"Authorization": f"Bearer {bc_auth.get_access_token()}"}
        response = requests.get(endpoint, headers=headers)
        if response.status_code == 200:
            items = response.json().get("value", [])
            if not items:
                return "No items found matching your query."
            logger.info(f"Found {len(items)} items matching '{item_name_query}'")

            item_info = []

            for item in items:
                logger.info(f" - {item['number']}: {item['displayName']}")
                item_info.append(f"number: {item.get('number', 'N/A')}, displayName: {item.get('displayName', 'N/A')}, category: {item.get('itemCategoryCode', 'N/A')}, unitPrice: {item.get('unitPrice', 'N/A')}")

            return "\n".join(item_info)
        else:
            return f"API error: {response.status_code} - {response.text}"
    except Exception as e:
        logger.error(f"Exception in search_items_by_name: {e}")
        return f"An error occurred while searching for items: {e}"
    
