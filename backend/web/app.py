import uvicorn
import base64
import argparse
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict, Any, Literal, Optional

from src.utils.business_central_auth import BusinessCentralAuth
from src.utils.microsoft_auth import MicrosoftAuth
from config.service_config import ServiceConfig, BCEnvironment
from src.utils.bc_env import get_bc_auth, set_current_bc_env, CURRENT_BC_ENV
from src.llm.openai_client import get_openai_client
from src.prompt_engineering.chains import build_sales_order_extraction_prompt, sales_order_parser
from src.agents.agent import build_customer_search_agent, build_product_item_search_agent
from src.utils.logger import get_logger, setup_logger

# ----------------------------------------
# Constants and Configuration
# ----------------------------------------
CORS_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://161.97.109.188:5173",
]

# Initialize FastAPI app and logger
app = FastAPI()
setup_logger()
logger = get_logger(__name__)

# ----------------------------------------
# Configuration and Auth Dependencies
# ----------------------------------------
config = ServiceConfig()

ms_auth = MicrosoftAuth(
    client_id=config.CLIENT_ID.get_secret_value(),
    client_secret=config.CLIENT_SECRET.get_secret_value(),
    tenant_id=config.TENANT_ID.get_secret_value(),
)

llm = get_openai_client(
    model_name=config.OPENAI_MODEL_NAME,
    api_key=config.OPENAI_API_KEY.get_secret_value(),
)

customer_search_agent = build_customer_search_agent(llm=llm)
product_item_search_agent = build_product_item_search_agent(llm=llm)

# ----------------------------------------
# Middleware
# ----------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # or CORS_ORIGINS if you want to restrict
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
logger.info("CORS middleware configured successfully.")

# ----------------------------------------
# Global Exception Handler
# ----------------------------------------
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"error": str(exc)},
    )


# ----------------------------------------
# Request Models
# ----------------------------------------
class SalesOrderLine(BaseModel):
    lineObjectNumber: str = Field(..., description="Item Number in BC")
    quantity: float = Field(..., description="Quantity to order")
    line_discount_percent: float = Field(..., description="Percentage discount applied to this item’s unit price for the sales order line.")

class AllocateLotsRequest(BaseModel):
    company_name: str = Field(..., description="BC Company Name")
    sales_order_id: str = Field(..., description="Sales Order ID / GUID in BC")

class Address(BaseModel):
    mode: Literal["DEFAULT", "CUSTOM"]
    addressLine1: Optional[str] = ""
    addressLine2: Optional[str] = ""
    city: Optional[str] = ""
    state: Optional[str] = ""
    postalCode: Optional[str] = ""
    country: Optional[str] = ""

class InsertSORequest(BaseModel):
    company_name: str
    customer_id: str
    customer_name: str = None
    external_doc_no: str = ""
    shipping_method_id: str = ""
    shipping_agent_code: str = ""
    sales_order_lines: List[SalesOrderLine]
    comments: str = ""
    ship_to_address: Optional[Address] = None
    order_discount_amount: float = 0.0

class InsertLotIntoSO(BaseModel):
    company_name: str
    selected_lots: List[Dict[str, Any]]
    sales_order_no: str

class UpdateEnvRequest(BaseModel):
    env_name: BCEnvironment

# ----------------------------------------
# API Endpoints
# ----------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/config/bc_env_options")
def get_bc_env_options():
    """
    Returns the current default BC environment from config and all available options.
    """
    logger.info("Fetching BC environment options.")
    return {
        "selected": config.BC_ENV_NAME,
        "options": [e.value for e in BCEnvironment],
    }


@app.post("/api/config/set_bc_env")
def set_bc_env(req: UpdateEnvRequest):
    """
    Updates the global Business Central environment based on user selection.
    NOTE: This is global for the whole backend process.
    """
    set_current_bc_env(req.env_name)
    logger.info(f"Updated global Business Central environment to: {CURRENT_BC_ENV}")
    return {"bc_env_name": CURRENT_BC_ENV.value if hasattr(CURRENT_BC_ENV, "value") else str(CURRENT_BC_ENV)}


@app.get("/api/config/onedrive_dir_path")
async def get_onedrive_dir_path():
    """
    Returns the OneDrive base directory path from configuration.
    """
    try:
        logger.debug("Fetching OneDrive directory path from configuration.")
        return {"onedrive_dir_path": config.ONEDRIVE_DIR_PATH}
    except Exception as e:
        logger.exception(f"Error retrieving OneDrive directory path: {e}")
        return {"onedrive_dir_path": None, "error": str(e)}


@app.get("/api/company_names")
async def get_company_names():
    """
    Retrieves all company names available in Business Central
    using the current global BC environment.
    """
    try:
        logger.info("Retrieving company names from Business Central...")
        auth = get_bc_auth()
        names = auth.get_company_names()
        logger.info(f"Successfully retrieved {len(names)} company names.")
        return {"company_names": names}
    except Exception as e:
        logger.exception(f"Error retrieving company names: {e}")
        return {"company_names": [], "error": str(e)}


@app.get("/api/country")
async def get_country(year: int):
    """
    Retrieves available countries (folders) in OneDrive for the given year.

    Args:
        year (int): Year to fetch folder contents for.

    Returns:
        dict: Contains list of country names.
    """
    try:
        logger.info(f"Retrieving countries for year: {year}")
        folder_name = f"{config.ONEDRIVE_DIR_PATH}/{year}"
        items = ms_auth.get_drive_folder(folder_name)
        countries = [item.get("name") for item in items]
        logger.info(f"Found {len(countries)} countries for year {year}.")
        return {"countries": countries}
    except Exception as e:
        logger.exception(f"Error retrieving countries for year {year}: {e}")
        return {"countries": [], "error": str(e)}


@app.get("/api/regions")
async def get_regions(country: str, year: int):
    """
    Retrieves available regions under a given country and year.

    Args:
        country (str): Country name.
        year (int): Year folder.

    Returns:
        dict: Contains list of regions.
    """
    try:
        logger.info(f"Retrieving regions for country: {country}, year: {year}")
        folder_name = f"{config.ONEDRIVE_DIR_PATH}/{year}/{country}"
        items = ms_auth.get_drive_folder(folder_name)
        regions = [item.get("name") for item in items]
        logger.info(f"Found {len(regions)} regions under {country}/{year}.")
        return {"regions": regions}
    except Exception as e:
        logger.exception(f"Error retrieving regions for {country} ({year}): {e}")
        return {"regions": [], "error": str(e)}


@app.get("/api/get_shipment_methods")
async def get_shipment_methods(company_name: str):
    """
    Retrieve shipment method records from Business Central for the specified company.

    Args:
        company_name (str): Exact name of the company as registered in Business Central.

    Returns:
        dict: Response containing success status and shipment methods or error status
    """
    logger.info(f"API request received: Fetching shipment methods for company '{company_name}'.")

    try:
        auth = get_bc_auth()
        result = auth.get_shipment_methods(company_name)

        if not result:
            logger.error(f"Empty response received when retrieving shipment methods for company '{company_name}'.")
            return {
                "status": "error",
                "message": "Empty response when retrieving shipment methods from Business Central.",
            }

        logger.info(f"Shipment method retrieval successful for company '{company_name}'.")
        return result

    except Exception as e:
        logger.exception(f"Unexpected error while retrieving shipment methods for company '{company_name}': {e}")
        return {"status": "error", "message": str(e)}
    

@app.get("/api/get_shipment_agents")
async def get_shipment_agents(company_name: str):
    """
    Retrieve shipment agent records from Business Central for the specified company.

    Args:
        company_name (str): Exact name of the company as registered in Business Central.

    Returns:
        dict: Response containing success status and shipment agent or error status
    """
    logger.info(f"API request received: Fetching shipment agent for company '{company_name}'.")

    try:
        auth = get_bc_auth()
        result = auth.get_shipment_agents(company_name)

        if not result:
            logger.error(f"Empty response received when retrieving shipment agent for company '{company_name}'.")
            return {
                "status": "error",
                "message": "Empty response when retrieving shipment agent from Business Central.",
            }

        logger.info(f"Shipment agent retrieval successful for company '{company_name}'.")
        return result

    except Exception as e:
        logger.exception(f"Unexpected error while retrieving shipment methods for company '{company_name}': {e}")
        return {"status": "error", "message": str(e)}
    

@app.get("/api/get_sales_order_details")
async def get_sales_order_details(folder_path: str):
    """
    Extracts and parses sales order details from images located in a OneDrive folder.

    Args:
        folder_path (str): Path to the OneDrive folder containing images.

    Returns:
        dict: Parsed sales orders or error message.
    """
    logger.info(f"Starting sales order extraction from folder: {folder_path}")

    try:
        folder_items = ms_auth.get_drive_folder(folder_path)
        if folder_items is None:
            logger.warning(f"Folder '{folder_path}' is empty or not found.")
            return {
                "error": (
                    f"The folder '{folder_path}' is empty or does not exist. "
                    "Please check the date and try again."
                )
            }
        logger.debug(f"Retrieved {len(folder_items)} items from {folder_path}.")

        fabrics_items = ms_auth.get_fabrics_items(folder_items)
        logger.debug(f"Filtered {len(fabrics_items)} fabric image items.")

        sales_orders_items = []
        sales_orders_images_b64 = []

        for i, item in enumerate(fabrics_items, start=1):
            logger.info(f"[{i}/{len(fabrics_items)}] Processing image: {item.get('name')}")
            try:
                image_bytes = item.get("content").getvalue()
                image_base64 = base64.b64encode(image_bytes).decode("utf-8")

                prompt = build_sales_order_extraction_prompt(image_base64)
                response = llm.invoke(prompt)
                logger.debug(f"LLM raw response: {response.content}")

                sales_order = sales_order_parser.parse(response.content)
                logger.info(f"Parsed sales order: {sales_order}")

                sales_orders_items.append(sales_order)
                sales_orders_images_b64.append(image_base64)
            except Exception as inner_e:
                logger.warning(f"Failed to process item {item.get('name')}: {inner_e}")

        logger.info(f"Completed sales order extraction for {len(sales_orders_items)} items.")
        return {
            "sales_orders_items": sales_orders_items,
            "sales_orders_images_b64": sales_orders_images_b64,
        }

    except Exception as e:
        logger.exception(f"Unhandled error in get_sales_order_details: {e}")
        return {"error": str(e)}


@app.get("/api/get_customer_details")
async def get_customer_details(company_name: str, customer_name_query: str):
    """
    Retrieves a list of unique customer names from the sales orders.

    Args:
        company_name (str): Name of the company to filter customers.
        customer_name_query (str): Query string to match customer names.

    Returns:
        dict: Contains a list of customer names.
    """
    logger.info("Retrieving unique customer names from sales orders.")

    try:
        customer_search_response = customer_search_agent.invoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            f"Please retrieve customer details for company '{company_name}' "
                            f"where the display name matches '{customer_name_query}'."
                        ),
                    }
                ]
            }
        )
        logger.debug(f"Customer search agent response: {customer_search_response}")
        structured_response = customer_search_response.get("structured_response")
        logger.debug(f"Structured response: {structured_response}")
        customers = []
        if structured_response and hasattr(structured_response, "customers"):
            customers = structured_response.customers

        customer_search_results = []
        for cust in customers:
            logger.info(f" - {cust.displayName} (Number: {cust.number})")
            customer_search_results.append(
                {
                    "number": cust.number,
                    "displayName": cust.displayName,
                    "addressLine1": cust.addressLine1,
                    "addressLine2": cust.addressLine2,
                    "city": cust.city,
                    "state": cust.state,
                    "country": cust.country,
                    "postalCode": cust.postalCode,
                    "phoneNumber": cust.phoneNumber,
                    "email": cust.email,
                }
            )

        logger.info(f"Found {len(customers)} unique customer names.")
        return {"customer_search_results": customer_search_results}
    except Exception as e:
        logger.exception(f"Error retrieving customer names: {e}")
        return {"customer_search_results": [], "error": str(e)}


@app.get("/api/get_item_details")
async def get_item_details(company_name: str, item_name_query: str, item_category: str):
    """
    Retrieves item details from Business Central based on the item name query.

    Args:
        company_name (str): Name of the company to filter items.
        item_name_query (str): Query string to match item names.
        item_category (str): Category to filter items.

    Returns:
        dict: Contains a list of item details.
    """
    logger.info("Retrieving item details from Business Central.")

    try:
        item_search_response = product_item_search_agent.invoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            f"Please retrieve item details for company '{company_name}' "
                            f"where the display name matches '{item_name_query}' "
                            f"and category is '{item_category}'."
                        ),
                    }
                ]
            }
        )
        logger.debug(f"Item search agent response: {item_search_response}")
        structured_response = item_search_response.get("structured_response")
        logger.debug(f"Structured response: {structured_response}")
        items = []
        if structured_response and hasattr(structured_response, "items"):
            items = structured_response.items

        item_search_results = []
        for item in items:
            logger.info(f" - {item.displayName} (Number: {item.number})")
            item_search_results.append(
                {
                    "number": item.number,
                    "displayName": item.displayName,
                    "itemCategoryCode": item.itemCategoryCode,
                    "unitPrice": item.unitPrice,
                }
            )

        logger.info(f"Found {len(items)} items matching the query.")
        return {"item_search_results": item_search_results}
    except Exception as e:
        logger.exception(f"Error retrieving item details: {e}")
        return {"item_search_results": [], "error": str(e)}


@app.get("/api/get_item_price_details")
async def get_item_price_details(company_name: str, item_no: str):
    """
    Retrieve the latest sales price for a given item from Business Central.

    This endpoint:
      - Calls the Sales Price custom API
      - Filters by salesCode = 'DEALER' and itemNo
      - Orders by startingDate DESC and returns the most recent price rule

    Args:
        company_name (str): Business Central company name.
        item_no (str): Item number to retrieve pricing for.

    Returns:
        dict: Contains the latest unit price and unit of measure.
              Defaults to {"unitPrice": 0, "unitOfMeasureCode": ""} on error.
    """
    try:
        auth = get_bc_auth()
        response = auth.get_item_price(company_name, item_no)
        rows = response.get("value", [])

        if not rows:
            logger.warning(f"No price found for item ({item_no}) in company ({company_name}).")
            return {"unitPrice": 0, "unitOfMeasureCode": ""}

        latest_price = rows[0]  # Get the first/latest unit price based on the starting date

        return {
            "unitPrice": latest_price.get("unitPrice", 0),
            "unitOfMeasureCode": latest_price.get("unitOfMeasureCode", ""),
        }

    except Exception as e:
        logger.exception(f"Error retrieving item price details: {e}")
        return {"unitPrice": 0, "unitOfMeasureCode": ""}

@app.get("/api/get_courier_details")
async def get_courier_details(company_name: str,courier_item_name: str = "COURIER/FREIGHT/TRANSPORT CHARGES"):
    """
    Retrieves courier item details from Business Central using the current BC environment.
    """
    try:
        auth = get_bc_auth()
        response = auth.get_courier_details(company_name, courier_item_name)
        logger.debug(f"Get Courier Details response: {response}")
        data = response.get("value", [])
        logger.debug(f"Data: {data}")
        if len(data) > 0:
            number = data[0]["number"]
            displayName = data[0]["displayName"]
            itemCategoryCode = data[0]["itemCategoryCode"]
            unitPrice = data[0]["unitPrice"]
            logger.info(
                f"Number: {number}, DisplayName: {displayName}, "
                f"Item Category Code: {itemCategoryCode}, Unit Price: {unitPrice}"
            )
            return {
                "number": number,
                "displayName": displayName,
                "itemCategoryCode": itemCategoryCode,
                "unitPrice": unitPrice,
            }
        return {
            "number": "",
            "displayName": "",
            "itemCategoryCode": "",
            "unitPrice": 0,
        }
    except Exception as e:
        logger.exception(f"Error retrieving courier details: {e}")
        return {
            "number": "",
            "displayName": "",
            "itemCategoryCode": "",
            "unitPrice": 0,
        }


@app.post("/api/insert_so_into_bc")
async def insert_so_into_bc(req: InsertSORequest):
    """
    Inserts a sales order into Business Central using the current BC environment.
    """
    try:
        auth = get_bc_auth()

        ship_to_address = req.ship_to_address.dict() if req.ship_to_address else None
        order_discount_amt = req.order_discount_amount or 0.0

        insert_kwargs = {
            "company_name": req.company_name,
            "customer_id": req.customer_id,
            "external_doc_no": req.external_doc_no,
            "shipping_method_id": req.shipping_method_id,
            "shipping_agent_code": req.shipping_agent_code,
            "sales_order_lines": [line.dict() for line in req.sales_order_lines],
            "comments": req.comments,
            "order_discount_amt": order_discount_amt
        }

        if ship_to_address and ship_to_address.get("mode") == "CUSTOM":
            insert_kwargs.update({
                "ship_to_name": req.customer_name,
                "ship_to_address": ship_to_address,
            })

        result = auth.insert_sales_order(**insert_kwargs)

        if not result:
            logger.error(f"Empty response received when inserting Sales Order with Company Name ({req.company_name} with cust id {req.customer_id}) into Business Central.")
            return {
                "status": "error",
                "message": "Empty response received when inserting Sales Order into Business Central.",
            }
        
        return result
    except Exception as e:
        logger.exception(f"Error inserting sales order: {e}")
        return {"status": "error", "message": str(e)}


@app.post("/api/allocate_sales_order_lots")
async def allocate_sales_order_lots(req: AllocateLotsRequest):
    """
    Allocates lots for a given sales order using the current BC environment.
    """
    try:
        auth = get_bc_auth()
        result = auth.allocate_sales_order_lots(
            req.company_name,
            req.sales_order_id,
        )
        if not result:
            logger.error(f"Empty response received when allocating Sales Order to Lots ({req.company_name} with Sales Order ID {req.sales_order_id})")
            return {
                "status": "error",
                "message": "Empty response received when allocating Sales Order into Lots.",
            }
        
        return result
    except Exception as e:
        logger.exception(f"Error allocating sales order item lots: {e}")
        return {"status": "error", "message": str(e)}


@app.post("/api/insert_lots_into_sales_order")
async def insert_lot_into_sales_order(req: InsertLotIntoSO):
    """
    Inserts selected lots into a sales order using the current BC environment.
    """
    try:
        auth = get_bc_auth()
        result = auth.insert_lot_into_sales_order(
            req.company_name,
            req.selected_lots,
            req.sales_order_no,
        )

        if not result:
            logger.error(f"Empty response received when inserting Lots into Sales Order (Sales Order ID {req.sales_order_no})")
            return {
                "status": "error",
                "message": "Empty response received when inserting Lots into Sales Order.",
            }
        
        return result
    except Exception as e:
        logger.exception(f"Error allocating sales order item lots: {e}")
        return {"status": "error", "message": str(e)}


# ----------------------------------------
# App Entrypoint
# ----------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the FastAPI application.")
    parser.add_argument(
        "--host",
        type=str,
        default="0.0.0.0",
        help="Host address to bind the server.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port number to bind the server.",
    )
    args = parser.parse_args()
    try:
        uvicorn.run(app, host=args.host, port=args.port)
    except Exception as e:
        logger.exception(f"Failed to start Uvicorn server: {e}")
