import requests
from typing import Dict, List, Optional
from config.service_config import ServiceConfig
from src.utils.logger import get_logger
from urllib.parse import quote
from io import BytesIO

logger = get_logger(__name__)
config = ServiceConfig()


def handle_response(response, context: str = "API call"):
    """
    Validate an HTTP response and return its JSON body.

    Args:
        response (requests.Response): Response object to validate.
        context (str): Short description of the operation for logging.

    Returns:
        dict: Parsed JSON body if status_code == 200.

    Raises:
        Exception: If the response status code is not 200.
    """
    if response.status_code == 200:
        logger.debug(f"{context} succeeded with status 200.")
        return response.json()
    else:
        logger.error(f"{context} failed. Status: {response.status_code}, Response: {response.text}")
        raise Exception(f"{context} failed. Status: {response.status_code}")


# Microsoft Graph Authentication
class MicrosoftAuth:
    """
    Minimal Microsoft Graph client for obtaining tokens and reading OneDrive resources.
    """

    def __init__(self, client_id: str, client_secret: str, tenant_id: str):
        """
        Initialize the MicrosoftAuth client.

        Args:
            client_id (str): Azure AD application (client) ID.
            client_secret (str): Azure AD application client secret.
            tenant_id (str): Azure AD tenant ID.
        """
        self.client_id = client_id
        self.client_secret = client_secret
        self.tenant_id = tenant_id
        self.token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
        self.scope = "https://graph.microsoft.com/.default"
        self.base_url = "https://graph.microsoft.com/v1.0"
        self.email = config.ONEDRIVE_EMAIL

    def get_access_token(self) -> Optional[str]:
        """
        Request an OAuth2 client-credentials token from Microsoft Identity Platform.

        Returns:
            Optional[str]: Access token string on success; None on error.
        """
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "scope": self.scope,
            "grant_type": "client_credentials",
        }

        try:
            logger.info("Requesting Microsoft Graph access token.")
            response = requests.post(self.token_url, data=data)
            token = handle_response(response, context="Microsoft Graph Token retrieval")["access_token"]
            logger.debug("Access token retrieved successfully.")
            return token
        except Exception as e:
            logger.error(f"Exception during token retrieval: {e}")
            return None

    def get_drive_id(self) -> Optional[str]:
        """
        Retrieve the Drive ID for the configured user.

        Returns:
            Optional[str]: The drive ID if successful; None on error.
        """
        endpoint = f"{self.base_url}/users/{self.email}/drive"
        access_token = self.get_access_token()
        logger.info(f"Retrieving Drive ID for user: {self.email}")
        try:
            headers = {"Authorization": f"Bearer {access_token}"}
            response = requests.get(endpoint, headers=headers)
            drive_id = handle_response(response, context="Drive ID retrieval")["id"]
            logger.debug(f"Drive ID retrieved: {drive_id}")
            return drive_id
        except Exception as e:
            logger.error(f"Exception during Drive ID retrieval: {e}")
            return None

    def get_drive_folder(self, folder_path: str):
        """
        List children under a OneDrive folder path.

        Args:
            folder_path (str): Path relative to the drive root.

        Returns:
            list | None: List of child items on success; None on error.
        """
        endpoint = f"{self.base_url}/drives/{self.get_drive_id()}/root:/{quote(folder_path)}:/children"
        access_token = self.get_access_token()
        logger.info(f"Retrieving OneDrive folder items. Path: {folder_path}")
        try:
            headers = {"Authorization": f"Bearer {access_token}"}
            response = requests.get(endpoint, headers=headers)
            folders = handle_response(response, context="Drive Folder retrieval").get("value", [])
            logger.debug(f"Retrieved {len(folders)} items from folder path '{folder_path}'.")
            return folders
        except Exception as e:
            logger.error(f"Exception during Drive Folder retrieval: {e}")
            return None

    def get_fabrics_items(self, folder_items: list):
        """
        Download image files (.jpg, .jpeg, .png) from a list of OneDrive items.

        Args:
            folder_items (list): Collection of OneDrive item dicts (from get_drive_folder).

        Returns:
            list: List of dicts with keys {'name', 'content'} where content is a BytesIO stream.
        """
        access_token = self.get_access_token()
        fabrics_img_items = []
        logger.info(f"Fetching fabric image files from {len(folder_items)} OneDrive items.")
        try:
            for item in folder_items:
                try:
                    if item.get("name", "").endswith((".jpg", "jpeg", ".png")):
                        file_id = item.get("id")
                        image_url = f"{self.base_url}/drives/{self.get_drive_id()}/items/{file_id}/content"
                        img_res = requests.get(image_url, headers={"Authorization": f"Bearer {access_token}"})
                        if img_res.status_code == 200:
                            fabrics_img_items.append({"name": item.get("name"), "content": BytesIO(img_res.content)})
                            logger.debug(f"Downloaded image: {item.get('name')}")
                        else:
                            logger.warning(
                                f"Skipping file '{item.get('name')}'. Non-200 status: {img_res.status_code}"
                            )
                except Exception as inner_e:
                    logger.error(f"Error fetching item '{item.get('name')}': {inner_e}")
            logger.info(f"Total fabric images fetched: {len(fabrics_img_items)}")
            return fabrics_img_items
        except Exception as e:
            logger.error(f"Exception during fabrics item retrieval: {e}")
            return []

    def get_drive_item(self):
        """
        Placeholder for retrieving a single drive item.
        """
        pass


# Business Central Auth (BC)
class BusinessCentralAuth:
    """
    Minimal Business Central API client for auth and common lookups.
    """

    def __init__(self, tenant_id, client_id, client_secret, azure_bc_env_name):
        """
        Initialize the BusinessCentralAuth client.

        Args:
            tenant_id (str): Azure AD tenant ID.
            client_id (str): Azure AD application (client) ID.
            client_secret (str): Azure AD application client secret.
            azure_bc_env_name (str): Business Central environment name.
        """
        self.tenant_id = tenant_id
        self.client_id = client_id
        self.client_secret = client_secret
        self.azure_bc_env_name = azure_bc_env_name
        self.token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
        self.base_url = f"https://api.businesscentral.dynamics.com/v2.0/{tenant_id}/{azure_bc_env_name}/api/v2.0"
        self.scope = "https://api.businesscentral.dynamics.com/.default"

    def get_access_token(self) -> Optional[str]:
        """
        Request an OAuth2 client-credentials token for Business Central.

        Returns:
            Optional[str]: Access token string on success; None on error.
        """
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "scope": self.scope,
            "grant_type": "client_credentials",
        }

        try:
            logger.info("Requesting Business Central access token.")
            response = requests.post(self.token_url, data=data)
            token = handle_response(response, context="BC Token retrieval")["access_token"]
            logger.debug("Business Central token retrieved successfully.")
            return token
        except Exception as e:
            logger.error(f"Exception during token retrieval: {e}")
            return None

    def get_company_info(self):
        """
        Retrieve the list of companies available in the current BC environment.

        Returns:
            dict | None: JSON payload containing companies; None on error.
        """
        access_token = self.get_access_token()
        headers = {"Authorization": f"Bearer {access_token}"}
        logger.info("Retrieving Business Central companies.")
        try:
            response = requests.get(f"{self.base_url}/companies", headers=headers)
            data = handle_response(response, context="BC Company Info Retrieval")
            logger.debug("Company info retrieved successfully.")
            return data
        except Exception as e:
            logger.error(f"Exception during company retrieval: {e}")
            return None

    def get_company_names(self):
        """
        Return a list of company names from Business Central.

        Returns:
            list | None: List of names; None on error.
        """
        logger.info("Retrieving Business Central company names.")
        try:
            company_list = (self.get_company_info() or {}).get("value", [])
            names = [company.get("name") for company in company_list]
            logger.debug(f"Retrieved {len(names)} company names.")
            return names
        except Exception as e:
            logger.error(f"Exception during company names retrieval: {e}")
            return None

    def get_company_id(self, company_name: str):
        """
        Find a company ID by its name.

        Args:
            company_name (str): Exact company name.

        Returns:
            str | None: Company ID on success; None on error.
        """
        logger.info(f"Resolving company ID for name: {company_name}")
        try:
            company_list = (self.get_company_info() or {}).get("value", [])
            for company in company_list:
                if company.get("name") == company_name:
                    company_id = company.get("id")
                    logger.debug(f"Company '{company_name}' resolved to ID: {company_id}")
                    return company_id
            available_names = [company.get("name") for company in company_list]
            logger.error(f"Company '{company_name}' not found. Available company names: {available_names}")
            raise Exception(f"Company '{company_name}' not found. Available company names: {available_names}")
        except Exception as e:
            logger.error(f"Exception during company id retrieval: {e}")
            return None

    def get_customer_info(self, company_id: str, customer_number: str):
        """
        Retrieve customer information by customer number.

        Args:
            company_id (str): Business Central company ID.
            customer_number (str): Customer number (e.g., 'C0001').

        Returns:
            dict | None: JSON payload with customer info; None on error.
        """
        access_token = self.get_access_token()
        headers = {"Authorization": f"Bearer {access_token}"}
        logger.info(f"Retrieving customer info. Company: {company_id}, Customer: {customer_number}")
        try:
            endpoint = f"{self.base_url}/companies({company_id})/customers?$filter=number eq '{customer_number}'"
            response = requests.get(endpoint, headers=headers)
            data = handle_response(response, context="BC Customer Info Retrieval")
            logger.debug("Customer info retrieved successfully.")
            return data
        except Exception as e:
            logger.error(f"Exception during customer retrieval: {e}")
            return None

    def get_courier_details(self, company_name: str, courier_item_name: str):
        """
        Search for a courier item by display name (contains filter).

        Args:
            company_name (str): Company name in Business Central.
            courier_item_name (str): Partial or full item display name.

        Returns:
            dict | None: JSON payload with items; None on error.
        """
        access_token = self.get_access_token()
        headers = {"Authorization": f"Bearer {access_token}"}
        company_id = self.get_company_id(company_name)
        logger.info(f"Retrieving courier item details. Company: {company_name}, Query: {courier_item_name}")
        try:
            endpoint = f"{self.base_url}/companies({company_id})/items?$filter=contains(displayName,'{quote(courier_item_name)}')"
            response = requests.get(endpoint, headers=headers)
            data = handle_response(response, context="BC Courier Info Retrieval")
            logger.debug("Courier item details retrieved successfully.")
            return data
        except Exception as e:
            logger.error(f"Exception during customer retrieval: {e}")
            return None

    def insert_sales_order(
        self,
        company_name: str,
        customer_id: str,
        external_doc_no: str,
        sales_order_lines: List[Dict],
        comments: str,
    ):
        """
        Create a new Sales Order in Business Central, insert its line items, and an optional comment line.

        Args:
            company_name (str): Name of the company in Business Central.
            customer_id (str): Customer number (e.g., 'CUST0001').
            external_doc_no (str): External document number (e.g., 'SO-2025-001').
            sales_order_lines (List[Dict]): List of sales order lines, each like:
                {'lineObjectNumber': 'JOT0006169', 'quantity': 1}
            comments (str): Comment text to insert as a comment line.

        Returns:
            dict: Result status and created sales order ID on success; error details on failure.
        """
        try:
            access_token = self.get_access_token()
            company_id = self.get_company_id(company_name)
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            }

            # Step 1: Create Sales Order
            so_endpoint = f"{self.base_url}/companies({company_id})/salesOrders"
            so_payload = {
                "customerNumber": customer_id,
                "externalDocumentNumber": external_doc_no,
            }

            logger.info(f"Creating Sales Order for customer '{customer_id}' under company '{company_name}'.")
            so_resp = requests.post(so_endpoint, headers=headers, json=so_payload)
            so_resp.raise_for_status()

            so_data = so_resp.json()
            so_id = so_data.get("id")
            if not so_id:
                raise ValueError("Sales Order ID not returned in response.")

            logger.info(f"Sales Order created successfully with ID: {so_id}")

            # Step 2: Insert each Sales Order Line
            line_endpoint = f"{self.base_url}/companies({company_id})/salesOrders({so_id})/salesOrderLines"
            for line in sales_order_lines:
                line_payload = {
                    "lineType": "Item",
                    "lineObjectNumber": line.get("lineObjectNumber"),
                    "quantity": line.get("quantity", 1),
                }

                logger.info(f"Inserting Sales Order Line: {line_payload}")
                line_resp = requests.post(line_endpoint, headers=headers, json=line_payload)
                line_resp.raise_for_status()

            logger.info(f"{len(sales_order_lines)} item line(s) inserted successfully.")

            # Step 3: Insert comment line (optional)
            if comments:
                comment_payload = {
                    "lineType": "Comment",
                    "description": comments,
                }
                logger.info(f"Inserting comment line.")
                comment_resp = requests.post(line_endpoint, headers=headers, json=comment_payload)
                comment_resp.raise_for_status()
                logger.info("Comment line inserted successfully.")

            logger.info("Sales Order creation completed successfully.")
            return {"status": "success", "sales_order_id": so_id}

        except requests.exceptions.HTTPError as e:
            logger.error(f"HTTP Error during Sales Order creation: {e.response.text}")
            return {"status": "error", "message": str(e), "details": e.response.text}
        except Exception as e:
            logger.exception(f"Unexpected error during Sales Order insertion: {e}")
            return {"status": "error", "message": str(e)}  


if __name__ == "__main__":
    microsoft_auth = MicrosoftAuth(
        client_id=config.CLIENT_ID.get_secret_value(),
        client_secret=config.CLIENT_SECRET.get_secret_value(),
        tenant_id=config.TENANT_ID.get_secret_value(),
    )
    logger.info(microsoft_auth.get_drive_folder("stock@jotexfabrics.com", "Fabrics Test"))

    # bc_auth = BusinessCentralAuth(
    #     client_id=config.CLIENT_ID.get_secret_value(),
    #     client_secret=config_CLIENT_SECRET.get_secret_value(),
    #     tenant_id=config.TENANT_ID.get_secret_value(),
    #     azure_bc_env_name="JoTexTest",
    # )
    # logger.info(bc_auth.get_company_info())
    # logger.info(bc_auth.get_company_id("CRONUS International Ltd."))
