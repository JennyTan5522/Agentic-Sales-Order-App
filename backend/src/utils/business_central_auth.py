import requests
import time
import pandas as pd
import re
import json
from typing import Optional, Dict, List, Any, Tuple
from datetime import datetime, date
from collections import defaultdict
from src.utils.utils import handle_response
from config.service_config import ServiceConfig
from src.utils.logger import get_logger
from urllib.parse import quote
from pdf2image import convert_from_bytes

logger = get_logger(__name__)
config = ServiceConfig()

class BusinessCentralAuth:
    """
    Minimal Business Central API client for auth and common lookups.
    """

    def __init__(self, tenant_id, client_id, client_secret, azure_bc_env_name):
        self.tenant_id = tenant_id
        self.client_id = client_id
        self.client_secret = client_secret
        self.azure_bc_env_name = azure_bc_env_name
        self.token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
        self.rest_api_base_url = f"https://api.businesscentral.dynamics.com/v2.0/{tenant_id}/{azure_bc_env_name}/api/v2.0"
        self.odata_api_base_url = f"https://api.businesscentral.dynamics.com/v2.0/{tenant_id}/{azure_bc_env_name}/ODataV4"
        self.scope = "https://api.businesscentral.dynamics.com/.default"

        # --- Token cache ---
        self._access_token: Optional[str] = None
        self._expires_at: float = 0

    def _request_new_token(self) -> Optional[str]:
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "scope": self.scope,
            "grant_type": "client_credentials",
        }

        try:
            logger.info("Requesting Business Central access token.")
            response = requests.post(self.token_url, data=data)
            body = handle_response(response, context="BC Token retrieval")

            token = body.get("access_token")
            expires_in = body.get("expires_in", 3600)

            if not token:
                raise Exception("No access_token in BC token response")

            now = time.time()
            self._access_token = token
            self._expires_at = now + int(expires_in) - 60  # safety margin

            logger.debug("Business Central token retrieved and cached successfully.")
            return token
        except Exception as e:
            logger.error(f"Exception during BC token retrieval: {e}")
            self._access_token = None
            self._expires_at = 0
            return None

    def get_access_token(self) -> Optional[str]:
        now = time.time()
        if self._access_token and now < self._expires_at:
            return self._access_token
        return self._request_new_token()

    def get_company_info(self):
        access_token = self.get_access_token()
        if not access_token:
            logger.error("No access token available for BC company retrieval.")
            return None

        headers = {"Authorization": f"Bearer {access_token}"}
        logger.info("Retrieving Business Central companies.")
        try:
            endpoint = f"{self.rest_api_base_url}/companies"
            logger.debug(f"Get Company Endpoint: {endpoint}")
            response = requests.get(endpoint, headers=headers)
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
        logger.info(f"Retrieving company ID for name: {company_name}")
        try:
            company_list = (self.get_company_info() or {}).get("value", [])
            for company in company_list:
                if company.get("name") == company_name:
                    company_id = company.get("id")
                    logger.debug(f"Company {company_name}'s ID: {company_id}")
                    return company_id
            available_names = [company.get("name") for company in company_list]
            logger.error(f"Company '{company_name}' not found. Available company names: {available_names}")
            raise Exception(f"Company '{company_name}' not found. Available company names: {available_names}")
        except Exception as e:
            logger.error(f"Exception during company id retrieval: {e}")
            return None

    def get_shipment_methods(self, company_name: str):
        """
        Fetch all shipment methods available for the specified Business Central company.

        Args:
            company_name (str): The exact display name of the company in Business Central.

        Returns:
            dict: A response dictionary containing status, shipment methods
        """
        logger.info(f"Fetching shipment methods for company: '{company_name}'")

        company_id = self.get_company_id(company_name)
        endpoint = f"{self.rest_api_base_url}/companies({company_id})/shipmentMethods"

        try:
            access_token = self.get_access_token()
            headers = {"Authorization": f"Bearer {access_token}"}

            logger.debug(f"Sending GET request to endpoint: {endpoint}")
            response = requests.get(endpoint, headers=headers)
            response.raise_for_status()

            data = response.json().get("value", [])
            logger.info(f"Successfully retrieved {len(data)} shipment method(s):\n{data}")

            return {"status": "success", "shipment_methods": data}

        except Exception as e:
            error_msg = str(e)
            response_text = getattr(getattr(e, "response", None), "text", "No response body")
            
            logger.error(
                f"Failed to retrieve shipment methods for company '{company_name}'. "
                f"Error: {error_msg}. Response: {response_text}"
            )

            return {
                "status": "error",
                "message": error_msg,
                "details": response_text,
            }

    def get_shipment_agents(self, company_name: str):
        """
        Fetch all shipment agents available for the specified Business Central company.

        Args:
            company_name (str): The exact display name of the company in Business Central.

        Returns:
            dict: A response dictionary containing status, shipment methods
        """
        logger.info(f"Fetching shipment agent for company: '{company_name}'")

        endpoint = f"{self.odata_api_base_url}/Company('{company_name}')/ShippingAgent"

        try:
            access_token = self.get_access_token()
            headers = {"Authorization": f"Bearer {access_token}"}

            logger.debug(f"Sending GET request to endpoint: {endpoint}")
            response = requests.get(endpoint, headers=headers)
            response.raise_for_status()

            data = response.json().get("value", [])
            logger.info(f"Successfully retrieved {len(data)} shipment agent(s):\n{data}")

            return {"status": "success", "shipment_agents": data}

        except Exception as e:
            error_msg = str(e)
            response_text = getattr(getattr(e, "response", None), "text", "No response body")
            
            logger.error(
                f"Failed to retrieve shipment methods for company '{company_name}'. "
                f"Error: {error_msg}. Response: {response_text}"
            )

            return {
                "status": "error",
                "message": error_msg,
                "details": response_text,
            }

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
            endpoint = f"{self.rest_api_base_url}/companies({company_id})/customers?$filter=number eq '{customer_number}'"
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
            endpoint = f"{self.rest_api_base_url}/companies({company_id})/items?$filter=contains(displayName,'{quote(courier_item_name)}')"
            response = requests.get(endpoint, headers=headers)
            data = handle_response(response, context="BC Courier Info Retrieval")
            logger.debug("Courier item details retrieved successfully.")
            return data
        except Exception as e:
            logger.error(f"Exception during customer retrieval: {e}")
            return None

    def get_item_price(self, company_name: str, item_no: str):
        """
        Retrieve the latest sales price for an item from the Sales Price API.

        The price is filtered by:
        - salesCode = 'DEALER' (Customer Price Group)
        - itemNo = provided item number and ordered by startingDate descending, returning only the most recent item price details.

        Args:
            company_name (str): Exact company name in Business Central.
            item_no (str): Item number from the Sales Order.

        Returns:
            dict | None: JSON payload returned by the Sales Price API; None on error.
        """
        access_token = self.get_access_token()
        headers = {"Authorization": f"Bearer {access_token}"}
        company_id = self.get_company_id(company_name)

        logger.info(f"Retrieving latest sales price for item ({item_no}) in company ({company_name}) with Customer Price Group = 'DEALER'.")

        try:
            endpoint = (
                f"https://api.businesscentral.dynamics.com/v2.0/"
                f"{self.tenant_id}/{self.azure_bc_env_name}/"
                f"api/publisherName/apiGroup/v1.0/companies({company_id})/salesPrices"
                f"?$filter=salesCode eq 'DEALER' and itemNo eq '{item_no}'"
                f"&$orderby=startingDate desc"
                f"&$top=1"
            )

            logger.debug(f"Sales Price API endpoint: {endpoint}")

            response = requests.get(endpoint, headers=headers)
            data = handle_response(response, context="Get Item Price")

            logger.debug(f"Sales price details retrieved successfully for item ({item_no}). Response: {data}")

            return data

        except Exception as e:
            logger.exception(f"Exception during item price retrieval for item ({item_no}) in company ({company_name}): {e}")
            return None

    def _create_sales_order(self, company_id: str, customer_id: str, external_doc_no: str, shipping_method_id: str, headers: Dict[str, str], ship_to_name: Optional[str]=None, ship_to_address: Optional[Dict[str, str]]=None) -> tuple:
        """
        Create a new Sales Order header in Business Central.

        Args:
            company_id (str): The internal Business Central company ID (GUID format).
            customer_id (str): The customer number to associate with the Sales Order (e.g., 'CUS000001').
            external_doc_no (str): External reference number for the Sales Order (e.g., PO number).
            shipping_method_id (str): The GUID of the Shipping Method record selected for this Sales Order.
            headers (Dict[str, str]): HTTP headers containing authorization and content type for the BC API request (e.g., `"Authorization": "Bearer <token>"`).
            ship_to_name (Optional[str], default=None): The Ship-To name to apply to the Sales Order. If None, the customer's default Ship-To name will be used.
            ship_to_address (Optional[Dict[str, str]], default=None):
                A dictionary containing custom Ship-To address fields, typically:
                {
                    "addressLine1": str,
                    "addressLine2": str,
                    "city": str,
                    "state": str,
                    "postalCode": str,
                    "country": str
                }
                If None, the default customer address will be used.

        Returns:
            tuple[str, str]: A tuple containing:
                - so_id: The unique Sales Order ID generated by Business Central.
                - so_no: The human-readable Sales Order number (e.g., 'SO-10001').
        """
        so_endpoint = f"{self.rest_api_base_url}/companies({company_id})/salesOrders"

        so_payload = {
                "customerNumber": customer_id,
                "externalDocumentNumber": external_doc_no,
                "shipmentMethodId": shipping_method_id,
        }

        if ship_to_name and ship_to_address:
            so_payload.update({
                "shipToName": ship_to_name,
                'shipToAddressLine1': ship_to_address.get("addressLine1"),
                'shipToAddressLine2': ship_to_address.get("addressLine2"),
                'shipToCity': ship_to_address.get("city"),
                'shipToCountry': ship_to_address.get("country"),
                'shipToState': ship_to_address.get("state"),
                'shipToPostCode': ship_to_address.get("postalCode"),
            })

        logger.info(f"Creating Sales Order for customer '{customer_id}' under company ID '{company_id}'.")
        response = requests.post(so_endpoint, headers=headers, json=so_payload)
        response.raise_for_status()

        so_data = response.json()
        so_id = so_data.get("id")
        so_no = so_data.get("number")
        if not so_id:
            raise ValueError("Sales Order ID not returned in response.")

        logger.info(f"Sales Order created successfully with ID: {so_id}")
        return so_id, so_no

    def _insert_shipping_agent(self, company_id: str, sales_order_no: str, shipping_agent_code: str):
        """
        Update the shipping agent code for a specific sales order in Business Central.

        Args:
            company_id (str): The target Business Central company ID.
            sales_order_no (str): Sales order number (e.g., "SO2503-0037").
            shipping_agent_code (str): The shipping agent code to assign.

        Returns:
            dict: Parsed JSON response from the Business Central API.
        """
        base_url = (
            f"https://api.businesscentral.dynamics.com/v2.0/"
            f"{self.tenant_id}/{self.azure_bc_env_name}/"
            f"api/publisherName/apiGroup/v1.0/companies({company_id})/salesOrderShippings"
        )
        endpoint = f"{base_url}(documentType='Order',no='{sales_order_no}')"
        logger.info(f"Attempting to update shipping agent for Sales Order '{sales_order_no}' with agent code '{shipping_agent_code}'.")

        try:
            access_token = self.get_access_token()
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                "If-Match": "*" 
            }
            payload = {"shippingAgentCode": shipping_agent_code}

            response = requests.patch(
                endpoint,
                headers=headers,
                data=json.dumps(payload)
            )

            # Raises HTTPError for 4xx/5xx responses
            response.raise_for_status()

            if response.status_code != 200:
                raise ValueError(f"Unexpected response code {response.status_code} received while updating shipping agent for Sales Order '{sales_order_no}'.")

            logger.info(f"Successfully updated shipping agent for Sales Order '{sales_order_no}' to '{shipping_agent_code}'.")

        except requests.HTTPError as http_err:
            logger.error(f"HTTP error while updating shipping agent for Sales Order '{sales_order_no}': {http_err} | Response: {response.text}")
            raise

        except Exception as e:
            logger.exception(f"Unexpected error occurred while updating shipping agent for Sales Order '{sales_order_no}': {e}")
            raise

    def _insert_sales_order_lines(self, company_id: str, so_id: str, sales_order_lines: List[Dict], headers: Dict[str, str]) -> None:
        """
        Insert all item lines for a given Sales Order ID.
        """
        line_endpoint = f"{self.rest_api_base_url}/companies({company_id})/salesOrders({so_id})/salesOrderLines"

        logger.info(f"Inserting {len(sales_order_lines)} sales order line(s).")
        logger.debug(f"Sales Order Line Items: {sales_order_lines}")

        for line in sales_order_lines:
            line_payload = {
                "lineType": "Item",
                "lineObjectNumber": line.get("lineObjectNumber"),
                "quantity": line.get("quantity", 1),
                "discountPercent": line.get("line_discount_percent")
            }

            logger.info(f"Inserting Sales Order Line: {line_payload}")
            response = requests.post(line_endpoint, headers=headers, json=line_payload)
            response.raise_for_status()

        logger.info(f"{len(sales_order_lines)} item line(s) inserted successfully.")

    def _insert_comment_line(self, company_id: str, so_id: str, comments: str, headers: Dict[str, str]) -> None:
        """
        Insert an optional comment line for the given Sales Order ID.
        """
        if not comments:
            logger.debug("No comments provided. Skipping comment line insertion.")
            return

        line_endpoint = f"{self.rest_api_base_url}/companies({company_id})/salesOrders({so_id})/salesOrderLines"
        comment_payload = {
            "lineType": "Comment",
            "description": comments,
        }

        logger.info("Inserting comment line.")
        response = requests.post(line_endpoint, headers=headers, json=comment_payload)
        response.raise_for_status()
        logger.info("Comment line inserted successfully.")

    def _update_total_discount_amount(self, access_token: str, company_id: str, so_id: str, discount_amount: float) -> None:
        """
        Update the total discount amount on an existing Sales Order in Business Central.

        Args:
            access_token (str): A valid OAuth2 Bearer token used to authenticate the request.
            company_id (str): The Business Central company identifier (GUID) where the Sales Order exists.
            so_id (str): The unique system ID of the Sales Order to be updated.
            discount_amount (float): The total discount amount (in LCY) to apply to the Sales Order.
        """

        endpoint = f"{self.rest_api_base_url}/companies({company_id})/salesOrders({so_id})"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "If-Match": "*"
        }
        payload = {"discountAmount": discount_amount}

        logger.info( f"Updating total discount amount for Sales Order (ID: {so_id}) with discount value: {discount_amount}.")

        response = requests.patch(endpoint, headers=headers, json=payload)
        response.raise_for_status()

        logger.info(f"Successfully updated total discount amount for Sales Order (ID: {so_id}).")

    def insert_sales_order(self, company_name: str, customer_id: str, external_doc_no: str, shipping_method_id: str, shipping_agent_code: str, sales_order_lines: List[Dict], comments: str, order_discount_amt: float, ship_to_name: Optional[str]=None, ship_to_address: Optional[Dict[str, str]]=None) -> Dict[str, str]:
        """
        Create a new Sales Order in Business Central, insert its line items, and an optional comment line.

        Args:
            company_name (str): Name of the company in Business Central.
            customer_id (str): Customer number (e.g., 'CUST0001').
            external_doc_no (str): External document number (e.g., 'SO-2025-001').
            shipping_method_id (str): The ID of the Shipping Method record in Business Central (a GUID).
            shipping_agent_code (str): The Code of the Shipping Method (e.g., 'FEDEX').
            sales_order_lines (List[Dict]): List of sales order lines, each like:
                {'lineObjectNumber': 'JOT0006169', 'quantity': 1}
            comments (str): Comment text to insert as a comment line.
            order_discount_amt (float): Order Discount total amount from the SO.
            ship_to_name (Optional[str], default=None): The Ship-To name to apply to the Sales Order. If None, the customer's default Ship-To name will be used.
            ship_to_address (Optional[Dict[str, str]], default=None): A dictionary containing custom Ship-To address fields.

        Returns:
            dict: Result status and created sales order ID and number on success; error details on failure.
        """
        try:
            # Resolve company ID and auth headers
            company_id = self.get_company_id(company_name)
            if not company_id:
                raise ValueError(f"Unable to resolve company ID for '{company_name}'.")

            access_token = self.get_access_token()
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            }

            # 1) Create Sales Order header
            so_id, so_no = self._create_sales_order(
                company_id=company_id,
                customer_id=customer_id,
                external_doc_no=external_doc_no,
                shipping_method_id=shipping_method_id,
                ship_to_name=ship_to_name,
                ship_to_address=ship_to_address,
                headers=headers,
            )

            # 2) Insert Shipping Agent
            self._insert_shipping_agent(
                company_id=company_id,
                sales_order_no=so_no,
                shipping_agent_code=shipping_agent_code
            )

            # 3) Insert item lines
            self._insert_sales_order_lines(
                company_id=company_id,
                so_id=so_id,
                sales_order_lines=sales_order_lines,
                headers=headers,
            )

            # 4) Insert optional comment line
            self._insert_comment_line(
                company_id=company_id,
                so_id=so_id,
                comments=comments,
                headers=headers,
            )

            # 5) Updae total discount amount in SO
            self._update_total_discount_amount(
                access_token=access_token,
                company_id=company_id,
                so_id=so_id, 
                discount_amount=order_discount_amt
            )

            logger.info("Sales Order creation completed successfully.")
            return {"status": "success", "sales_order_id": so_id, "sales_order_no": so_no}

        except requests.exceptions.HTTPError as e:
            logger.error(f"HTTP Error during Sales Order creation: {e.response.text}")
            return {
                "status": "error",
                "message": str(e),
                "details": e.response.text,
            }
        except Exception as e:
            logger.exception(f"Unexpected error during Sales Order insertion: {e}")
            return {"status": "error", "message": str(e)}
        
    def get_lot_requested_qty(self, company_id: str) -> Dict[str, float]:
        """
        Build a mapping of lot number -> requested quantity based on Reservation Entries
        for a given company.

        This is used to adjust available quantity by subtracting (usually negative) reserved
        quantities per lot.
        """
        endpoint = (
            f"https://api.businesscentral.dynamics.com/v2.0/"
            f"{self.tenant_id}/{self.azure_bc_env_name}/"
            f"api/publisherName/apiGroup/v1.0/companies({company_id})/ReservationEntries"
        )

        access_token = self.get_access_token()
        if not access_token:
            logger.error("Failed to retrieve access token for ReservationEntries lookup.")
            return {}

        headers = {"Authorization": f"Bearer {access_token}"}

        try:
            logger.info(f"Fetching reservation entries for CompanyID={company_id}")
            response = requests.get(endpoint, headers=headers)
            response.raise_for_status()
            reservation_values = response.json().get("value", [])
            logger.debug(f"Retrieved {len(reservation_values)} reservation entries.")
        except requests.exceptions.RequestException as e:
            logger.error(f"Error fetching reservation entries for CompanyID={company_id}: {e}")
            return {}

        requested_qty_map: Dict[str, float] = {}

        # Aggregate requested quantity per lot number
        for entry in reservation_values:
            lot_no = entry.get("lotNo")
            qty = entry.get("quantity", 0) or 0
            if lot_no:
                requested_qty_map[lot_no] = requested_qty_map.get(lot_no, 0) + qty

        logger.info(f"Built requested quantity map for {len(requested_qty_map)} lot(s) for CompanyID={company_id}.")
        logger.debug(f"Requested quantity map: {requested_qty_map}")
        return requested_qty_map

    def get_sales_order_lines(self, company_id: str, sales_order_id: str) -> List[Dict[str, Any]]:
        """
        Fetch all sales order lines for a given Sales Order.

        Args:
            company_id (str): Business Central company ID.
            sales_order_id (str): Sales Order ID.

        Returns:
            List[dict]: List of sales order line records (may be empty on error).
        """
        endpoint = (f"{self.rest_api_base_url}/companies({company_id})/salesOrders({sales_order_id})/salesOrderLines")

        access_token = self.get_access_token()
        if not access_token:
            logger.error(f"Failed to retrieve access token for SalesOrder lines. CompanyID={company_id}, SalesOrderID={sales_order_id}")
            return []

        headers = {"Authorization": f"Bearer {access_token}"}

        try:
            logger.info(f"Fetching sales order lines for SalesOrderID={sales_order_id}")
            response = requests.get(endpoint, headers=headers)
            response.raise_for_status()
            data = response.json().get("value", [])
            logger.debug(f"Retrieved {len(data)} sales order line(s).")
            return data
        except requests.exceptions.RequestException as e:
            logger.error(f"Error fetching sales order lines for SalesOrderID={sales_order_id}: {e}")
            return []

    def get_company_location_code(self, company_id: str, location_id: str) -> Tuple[str, str]:
        """
        Retrieve location code and display name for a given location ID.

        Args:
            company_id (str): Business Central company ID.
            location_id (str): Location record ID.

        Returns:
            (location_code, location_name): Empty code if lookup fails.
        """
        location_endpoint = (f"{self.rest_api_base_url}/companies({company_id})/locations({location_id})")

        access_token = self.get_access_token()
        if not access_token:
            logger.error(f"Failed to retrieve access token for location lookup. CompanyID={company_id}, LocationID={location_id}")
            return "", "N/A"

        headers = {"Authorization": f"Bearer {access_token}"}

        try:
            logger.debug(f"Fetching location details for CompanyID={company_id}, LocationID={location_id}")
            location_response = requests.get(location_endpoint, headers=headers)
            location_response.raise_for_status()
            location_data = location_response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Error fetching location details for LocationID={location_id}: {e}")
            return "", "N/A"

        location_code = location_data.get("code", "")
        location_name = location_data.get("displayName", "N/A")

        logger.info(f"Resolved location: LocationID={location_id}, Code={location_code}, Name={location_name}")
        return location_code, location_name

    def get_item_lot_ledger_entries(self, company_name: str, item_no: str, location_code: str) -> Dict[str, Any]:
        """
        Query Item Ledger Entries for a given item and location, filtered to
        non-empty lot numbers with remaining quantity > 0.

        Args:
            company_name (str): Business Central company name.
            item_no (str): Item number.
            location_code (str): Location code.

        Returns:
            dict: Raw JSON response from the ItemLedgerEntries OData endpoint.
        """
        logger.info(f"Querying available lot numbers for ItemNo={item_no} at LocationCode={location_code}")

        filter_string = (
            f"Item_No eq '{item_no}' and "
            f"Lot_No ne '' and "
            f"Remaining_Quantity gt 0 and "
            f"Location_Code eq '{location_code}'"
        )

        ledger_endpoint = (
            f"{self.odata_api_base_url}/Company('{company_name}')/ItemLedgerEntries"
            f"?$filter={filter_string}"
            f"&$select=Entry_No,Item_No,Lot_No,Location_Code,Posting_Date,Remaining_Quantity,Expiration_Date"
        )

        access_token = self.get_access_token()
        if not access_token:
            logger.error(
                f"Failed to retrieve access token for ItemLedgerEntries. "
                f"Company='{company_name}', ItemNo={item_no}, LocationCode={location_code}"
            )
            return {}

        headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}

        try:
            logger.debug(f"Executing ItemLedgerEntries query: URL={ledger_endpoint}")
            r = requests.get(ledger_endpoint, headers=headers)
            r.raise_for_status()
            logger.debug(f"Ledger query completed with StatusCode={r.status_code} for ItemNo={item_no}, LocationCode={location_code}")
            return r.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Error querying ItemLedgerEntries for ItemNo={item_no}, LocationCode={location_code}: {e}")
            return {}

    def group_lot_records(self, lot_ledger_entries: Dict[str, Any], item_no: str, line_no: str, location_code: str, quantity: int, requested_qty_map: dict) -> List[Dict[str, Any]]:
        """
        Group Item Ledger Entries by lot number and compute remaining, requested,
        and available quantity per lot for a given sales line.

        Args:
            lot_ledger_entries (dict): Raw JSON from ItemLedgerEntries OData.
            item_no (str): Item number of the sales line.
            line_no (str): Sales line sequence/line number.
            location_code (str): Location code.
            quantity (int): Ordered quantity on the sales line.
            requested_qty_map (dict): Mapping of lotNo -> requested quantity from Reservation Entries.

        Returns:
            List[dict]: List with a single aggregated lot summary for the line, or empty if no lots.
        """
        lot_list: List[Dict[str, Any]] = []

        if "value" in lot_ledger_entries and len(lot_ledger_entries["value"]) > 0:
            logger.info(f"Lot entries found for ItemNo={item_no}: Count={len(lot_ledger_entries['value'])}")
            df = pd.DataFrame(lot_ledger_entries["value"])

            lots_df = (
                df.groupby("Lot_No")
                .agg({"Remaining_Quantity": "sum", "Posting_Date": "max"})
                .reset_index()
            )

            # Map requested quantity (negative values from reservation entries)
            lots_df["Requested_Quantity"] = lots_df["Lot_No"].map(requested_qty_map).fillna(0)

            # Compute available quantity
            lots_df["Available_Quantity"] = (lots_df["Remaining_Quantity"] + lots_df["Requested_Quantity"]).round(2)

            lot_records = lots_df.to_dict("records")
            lot_data = {
                "Item_No": item_no,
                "Line_No": line_no,
                "Location_Code": location_code,
                "Quantity": quantity,
                "Lot_Records": lot_records,
            }

            lot_list.append(lot_data)

            logger.info(
                f"Computed lot availability for ItemNo={item_no} at LocationCode={location_code}: "
                f"Lots={len(lot_records)}"
            )
            logger.debug(f"Lot records detail: {lot_data}")
        else:
            logger.warning(f"No available lot entries found for ItemNo={item_no} at LocationCode={location_code}")

        return lot_list

    def get_sales_order_lot_details(self, company_id: str, company_name: str, sales_order_id: str) -> List[Dict[str, Any]]:
        """
        Retrieve lot availability details for all lines in a Sales Order.

        For each sales order line, this method:
        - Resolves the location code,
        - Queries Item Ledger Entries for the item and location,
        - Aggregates remaining and requested quantities by lot, and
        - Produces a per-line lot summary record.
        """
        # Step 1 — Get sales order lines
        sales_order_lines_data = self.get_sales_order_lines(company_id, sales_order_id)
        requested_qty_map = self.get_lot_requested_qty(company_id)

        lot_list: List[Dict[str, Any]] = []

        # Step 2 — Process each line
        for line_item in sales_order_lines_data:
            logger.info(
                f"Processing sales order line: "
                f"Sequence={line_item.get('sequence')}, "
                f"ItemNo={line_item.get('lineObjectNumber')}"
            )

            location_id = line_item["locationId"]
            item_no = line_item["lineObjectNumber"]
            line_no = line_item["sequence"]
            quantity = line_item["quantity"]

            logger.debug(f"Line details: LocationID={location_id}, ItemNo={item_no}, LineNo={line_no}, Quantity={quantity}")

            # Step 3 — Get location details (TODO: Just retrieve only once)
            location_code, location_name = self.get_company_location_code(company_id, location_id)

            if not location_code:
                logger.error(f"Failed to resolve location code for LocationID={location_id}, CompanyID={company_id}. Skipping line.")
                continue

            logger.info(f"Resolved location: LocationID={location_id}, Code={location_code}, Name={location_name}")

            # Step 4 — Query Item Ledger Entries for this item/location
            lot_ledger_entries = self.get_item_lot_ledger_entries(company_name, item_no, location_code)

            # Step 5 — Process and group lots for this line
            line_lot_list = self.group_lot_records(
                lot_ledger_entries,
                item_no,
                line_no,
                location_code,
                quantity,
                requested_qty_map,
            )

            lot_list.extend(line_lot_list)

        logger.info(f"Completed lot retrieval for SalesOrderID={sales_order_id}. Total line(s) with lot info: {len(lot_list)}")
        return lot_list

    def allocate_item_lots_fifo(self, lot_data: dict) -> dict:
        """
        Allocate lots for a single item according to FIFO rules with PO-group priority.

        The function performs:
            1. Parse Posting_Date into datetime.date
            2. Extract PO number from Lot_No
            3. Group lots by PO
            4. Sort each group internally by Posting_Date (oldest first)
            5. Sort groups (PO groups) by earliest Posting_Date
            6. Flatten into a single FIFO sequence
            7. Allocate quantities from FIFO until required quantity is fulfilled

        Args:
            lot_data (dict): Structure:
            {
                "Item_No": str,
                "Line_No ": str,
                "Location_Code": str,
                "Quantity": float,
                "Lot_Records": [
                    {
                        "Lot_No": str,
                        "Remaining_Quantity": float,
                        "Requested_Quantity": float,
                        "Available_Quantity": float,
                        "Posting_Date": "YYYY-MM-DD",
                        ...
                    }
                ]
            }

        Returns:
            dict: Allocation summary:
                {
                    "Item_No": ...,
                    "Line_No": ...,
                    "Location_Code": ...,
                    "Requested_Qty": ...,
                    "Selected_Lots": [...],
                    "Unfulfilled_Qty": ...
                }
        """
        def to_date(v):
            """Convert posting date input into a datetime.date object."""
            try:
                if isinstance(v, date):
                    return v
                if isinstance(v, datetime):
                    return v.date()
                if isinstance(v, str):
                    return datetime.strptime(v, "%Y-%m-%d").date()

                raise TypeError(f"Unsupported date type: {type(v)}")
            except Exception as e:
                logger.error(f"Error parsing date '{v}': {e}")
                raise

        def get_PO(lot_no: str):
            """
            Extract PO number from lot number pattern.

            Example:
                'L1#24060015-1520' → '24060015'

            Returns:
                str | None
            """
            try:
                pattern = re.compile(r"#([^-\s#/]+)-")
                match = pattern.search(lot_no)
                po_number = match.group(1) if match else None
                logger.debug(f"Extracted PO '{po_number}' from LotNo='{lot_no}'")
                return po_number
            except Exception as e:
                logger.error(f"Failed to extract PO from LotNo='{lot_no}': {e}")
                return None

        item_no = lot_data["Item_No"]
        line_no = lot_data["Line_No"]
        location_code = lot_data["Location_Code"]
        required_qty = lot_data["Quantity"]
        lot_records = lot_data["Lot_Records"]

        logger.info(f"Starting lot allocation for ItemNo={item_no}, RequiredQty={required_qty}")

        # ---- Step 1: Parse Posting_Date & Step 2: Extract PO ----
        for lot in lot_records:
            try:
                lot["Posting_Date"] = to_date(lot["Posting_Date"])
                lot["PO"] = get_PO(lot["Lot_No"])
            except Exception:
                logger.error(f"Skipping lot due to invalid data: {lot}")
                continue

        # ---- Step 3: Group by PO ----
        groups = defaultdict(list)
        for lot in lot_records:
            groups[lot["PO"]].append(lot)

        logger.debug(f"Grouped {len(groups)} PO groups for item {item_no}.")

        # ---- Step 4: Sort each group by Posting_Date ----
        for po, items in groups.items():
            items.sort(key=lambda x: x["Posting_Date"])
            logger.debug(f"Sorted PO group '{po}' by Posting_Date.")

        # ---- Step 5: Order PO groups by earliest Posting_Date ----
        group_order = sorted(
            ((po, items[0]["Posting_Date"]) for po, items in groups.items()),
            key=lambda x: x[1]
        )
        logger.debug(f"PO group processing order: {group_order}")

        # ---- Step 6: Flatten FIFO sequence ----
        ordered_lots = []
        for po, _ in group_order:
            ordered_lots.extend(groups[po])

        logger.debug(f"Flattened FIFO sequence contains {len(ordered_lots)} lot entries.")

        # ---- Step 7: Select lots until requirement is met ----
        selected_lots = []
        remaining_need = required_qty

        for lot in ordered_lots:
            if remaining_need <= 0:
                break

            available = lot["Available_Quantity"]
            take = min(available, remaining_need)

            if take > 0:
                selected_lots.append({
                    "Lot_No": lot["Lot_No"],
                    "PO": lot["PO"],
                    "Posting_Date": lot["Posting_Date"].isoformat(),
                    "Selected_Qty": round(take, 4),
                })
                logger.info(
                    f"Allocated {take} from LotNo={lot['Lot_No']} (PO={lot['PO']}). "
                    f"Remaining need: {round(remaining_need - take, 4)}"
                )
                remaining_need -= take

        logger.info(
            f"Completed allocation for ItemNo={item_no}. "
            f"SelectedLots={len(selected_lots)}, Unfulfilled={remaining_need}"
        )

        return {
            "Item_No": item_no,
            "Line_No": line_no,
            "Location_Code": location_code,
            "Requested_Qty": required_qty,
            "Selected_Lots": selected_lots,
            "Unfulfilled_Qty": round(remaining_need, 4),
        }

    def allocate_sales_order_lots(self, company_name: str, sales_order_id: str):
        """
        Perform lot allocation for all line items in a Sales Order.

        Retrieves:
            - All sales order line items
            - Their available lots
            - Applies FIFO+PO allocation for each item

        Returns:
            list[dict]: Allocation results per item.
        """
        logger.info(f"Starting lot allocation workflow for SalesOrderID={sales_order_id}")

        company_id = self.get_company_id(company_name)
        if not company_id:
            raise ValueError(f"Unable to resolve company ID for '{company_name}'.")

        selected_lots = []

        try:
            lot_list = self.get_sales_order_lot_details(company_id, company_name, sales_order_id)
            logger.info(f"Retrieved {len(lot_list)} item entries with lot details.")
        except Exception as e:
            logger.error(f"Failed to retrieve lot details for SalesOrderID={sales_order_id}: {e}")
            return []

        for lot_data in lot_list:
            try:
                result = self.allocate_item_lots_fifo(lot_data)
                selected_lots.append(result)
            except Exception as e:
                logger.error(f"Error allocating lots for ItemNo={lot_data.get('Item_No')}: {e}")

        logger.info(
            f"Completed allocation for SalesOrderID={sales_order_id}. "
            f"ItemsProcessed={len(selected_lots)}"
        )

        logger.debug(f"Allocation results: {selected_lots}")
        return {"status": "success", "lot_list": lot_list, "selected_lots": selected_lots}

    def insert_lot_into_sales_order(self, company_name: str, selected_lots: List[Dict[str, Any]], sales_order_no: str) -> None:
        """Main entry to insert lots into a sales order."""
        try:
            company_id = self.get_company_id(company_name)
            access_token = self.get_access_token()
            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": f"Bearer {access_token}"
            }

            logger.info(f"Starting lot assignment for sales_order='{sales_order_no}' company='{company_name}' company_id='{company_id}' total_items={len(selected_lots)}")

            for item_lot in selected_lots:
                self._insert_item_lots_for_sales_order(company_id, headers, sales_order_no, item_lot)

            logger.info(f"Completed lot assignment for sales_order='{sales_order_no}' company='{company_name}'")
            return {"status": "success"}

        except Exception as e:
            logger.error(f"Failed lot assignment for sales_order='{sales_order_no}' company='{company_name}' error='{e}'")
            return {
                "status": "error",
                "message": str(e),
                "details": e.response.text,
            }

    def _insert_item_lots_for_sales_order(self, company_id: str, headers: Dict[str, str], sales_order_no: str, item_lot_group: Dict[str, Any]) -> None:
        """Insert all selected lots for a specific item line in a sales order."""
        item_no = item_lot_group.get("Item_No")
        line_no = item_lot_group.get("Line_No")
        location_code = item_lot_group.get("Location_Code")
        selected_lots = item_lot_group.get("Selected_Lots", [])

        logger.info(f"Processing item='{item_no}' line_no={line_no} location='{location_code}' sales_order='{sales_order_no}' selected_lots={len(selected_lots)}")
        endpoint = (
            f"https://api.businesscentral.dynamics.com/v2.0/"
            f"{self.tenant_id}/{self.azure_bc_env_name}/"
            f"api/publisherName/apiGroup/v1.0/companies({company_id})/ReservationEntries"
        )

        for lot_entry in selected_lots:
            lot_no = lot_entry.get("Lot_No")
            qty_assigned = lot_entry.get("Selected_Qty")

            if lot_no is None or qty_assigned is None:
                logger.warning(f"Skipping invalid lot entry for item='{item_no}' sales_order='{sales_order_no}' line_no={line_no} raw='{lot_entry}'")
                continue

            payload = {
                "itemNo": item_no,
                "locationCode": location_code,
                "quantityBase": -qty_assigned,
                "lotNo": lot_no,
                "reservationStatus": "Prospect",
                "creationDate": date.today().isoformat(),
                "sourceType": 37, # 37 = Sales Line
                "sourceSubtype": "1", # 1 = Order
                "sourceID": sales_order_no,
                "sourceRefNo": line_no,
                "Quantity": -qty_assigned,
            }

            try:
                self._create_reservation_entry(endpoint, headers, payload, item_no, lot_no, line_no, sales_order_no, qty_assigned)
            except Exception as exc:
                logger.error(f"Skipping lot='{lot_no}' item='{item_no}' qty={qty_assigned} sales_order='{sales_order_no}' line_no={line_no} error='{exc}'")

    def _create_reservation_entry(self, endpoint: str, headers: Dict[str, str], payload: Dict[str, Any], item_no: str, lot_no: str, line_no: int, sales_order_no: str, qty_assigned: float, timeout: int = 30) -> None:
        """Call Business Central to create a reservation entry for a lot."""
        logger.info(f"Attempting POST ReservationEntry lot='{lot_no}' qty={qty_assigned} item='{item_no}' sales_order='{sales_order_no}' line_no={line_no}")

        try:
            response = requests.post(endpoint, headers=headers, json=payload, timeout=timeout)

            logger.info(f"POST ReservationEntry returned status={response.status_code} lot='{lot_no}' item='{item_no}' sales_order='{sales_order_no}' line_no={line_no}")
            logger.debug(f"ReservationEntry raw_response lot='{lot_no}' sales_order='{sales_order_no}' line_no={line_no} body='{response.text}'")

            response.raise_for_status()

            logger.info(f"ReservationEntry created lot='{lot_no}' qty={qty_assigned} item='{item_no}' sales_order='{sales_order_no}' line_no={line_no}")
            logger.debug(f"ReservationEntry json_response lot='{lot_no}' sales_order='{sales_order_no}' line_no={line_no} json='{response.json()}'")

        except requests.HTTPError as http_err:
            status = http_err.response.status_code if http_err.response else "N/A"
            body = http_err.response.text if http_err.response else "N/A"
            logger.error(f"HTTPError creating ReservationEntry lot='{lot_no}' item='{item_no}' qty={qty_assigned} sales_order='{sales_order_no}' line_no={line_no} status={status} body='{body}'")
            raise

        except requests.RequestException as req_err:
            logger.error(f"RequestException creating ReservationEntry lot='{lot_no}' item='{item_no}' qty={qty_assigned} sales_order='{sales_order_no}' line_no={line_no} error='{req_err}'")
            raise

        except Exception as exc:
            logger.error(f"Unexpected error creating ReservationEntry lot='{lot_no}' item='{item_no}' qty={qty_assigned} sales_order='{sales_order_no}' line_no={line_no} error='{exc}'")
            raise