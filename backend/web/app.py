import uvicorn
import base64
import argparse
from fastapi import FastAPI
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict

from src.utils.access_auth import BusinessCentralAuth, MicrosoftAuth
from config.service_config import ServiceConfig
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
]

# Initialize FastAPI app and logger
app = FastAPI()
setup_logger()
logger = get_logger(__name__)

# ----------------------------------------
# Configuration and Auth Dependencies
# ----------------------------------------
config = ServiceConfig()

bc_auth = BusinessCentralAuth(
    tenant_id=config.TENANT_ID.get_secret_value(),
    client_id=config.CLIENT_ID.get_secret_value(),
    client_secret=config.CLIENT_SECRET.get_secret_value(),
    azure_bc_env_name=config.BC_ENV_NAME)

ms_auth = MicrosoftAuth(
    client_id=config.CLIENT_ID.get_secret_value(),
    client_secret=config.CLIENT_SECRET.get_secret_value(),
    tenant_id=config.TENANT_ID.get_secret_value())

llm = get_openai_client(
    model_name=config.OPENAI_MODEL_NAME, 
    api_key=config.OPENAI_API_KEY.get_secret_value())

customer_search_agent = build_customer_search_agent(llm=llm)
product_item_search_agent = build_product_item_search_agent(llm=llm)

# ----------------------------------------
# Middleware
# ----------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
logger.info("CORS middleware configured successfully.")


# ----------------------------------------
# API Endpoints
# ----------------------------------------
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
    Retrieves all company names available in Business Central.

    Returns:
        dict: Contains list of company names.
    """
    try:
        logger.info("Retrieving company names from Business Central...")
        names = bc_auth.get_company_names()
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
        logger.debug(f"Retrieved {len(folder_items)} items from {folder_path}.")

        fabrics_items = ms_auth.get_fabrics_items(folder_items)
        logger.debug(f"Filtered {len(fabrics_items)} fabric image items.")

        sales_orders_items = []
        sales_orders_images_b64 = []

        for i, item in enumerate(fabrics_items, start=1):
            logger.info(f"[{i}/{len(fabrics_items)}] Processing image: {item.get('name')}")
            try:
                image_bytes = item.get("content").getvalue()
                image_base64 = base64.b64encode(image_bytes).decode('utf-8')

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
        return {"sales_orders_items": sales_orders_items, "sales_orders_images_b64": sales_orders_images_b64}

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
        customer_search_response = customer_search_agent.invoke({
            "messages": [{"role": "user", "content": f"Please retrieve customer details for company '{company_name}' where the display name matches '{customer_name_query}'."}]
        })
        logger.debug(f"Customer search agent response: {customer_search_response}")
        structured_response = customer_search_response.get("structured_response")
        logger.debug(f"Structured response: {structured_response}")
        if structured_response and hasattr(structured_response, "customers"):
            customers = structured_response.customers

        customer_search_results = []
        for cust in customers:
            logger.info(f" - {cust.displayName} (Number: {cust.number})")
            customer_search_results.append({
                "number": cust.number,
                "displayName": cust.displayName,
                "addressLine1": cust.addressLine1,
                "addressLine2": cust.addressLine2,
                "city": cust.city,
                "state": cust.state,
                "country": cust.country,
                "postalCode": cust.postalCode,
                "phoneNumber": cust.phoneNumber,
                "email": cust.email
            })
        
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
        item_search_response = product_item_search_agent.invoke({
            "messages": [{"role": "user", "content": f"Please retrieve item details for company '{company_name}' where the display name matches '{item_name_query}' and category is '{item_category}'."}]
        })
        logger.debug(f"Item search agent response: {item_search_response}")
        structured_response = item_search_response.get("structured_response")
        logger.debug(f"Structured response: {structured_response}")
        if structured_response and hasattr(structured_response, "items"):
            items = structured_response.items

        item_search_results = []
        for item in items:
            logger.info(f" - {item.displayName} (Number: {item.number})")
            item_search_results.append({
                "number": item.number,
                "displayName": item.displayName,
                "itemCategoryCode": item.itemCategoryCode,
                "unitPrice": item.unitPrice
            })
        
        logger.info(f"Found {len(items)} items matching the query.")
        return {"item_search_results": item_search_results}
    except Exception as e:
        logger.exception(f"Error retrieving item details: {e}")
        return {"item_search_results": [], "error": str(e)}


@app.get("/api/get_courier_details")
async def get_courier_details(company_name: str, courier_item_name: str="COURIER/FREIGHT/TRANSPORT CHARGES"):
    try:
        response = bc_auth.get_courier_details(company_name, courier_item_name)
        logger.debug(f"Get Courier Details response: {response}")
        data = response.get('value',[])
        logger.debug(f"Data: {data}")
        if len(data) > 0:
            number = data[0]['number']
            displayName = data[0]['displayName']
            itemCategoryCode = data[0]['itemCategoryCode']
            unitPrice = data[0]['unitPrice']
            logger.info(f"Number: {number}, DisplayName: {displayName}, Item Category Code: {itemCategoryCode}, Unit Price: {unitPrice}")
            return {"number": number, "displayName": displayName, "itemCategoryCode": itemCategoryCode, "unitPrice": unitPrice}
    except Exception as e:
        logger.exception(f"Error retrieving courier details: {e}")
        return {"number": "", "displayName": "", "itemCategoryCode": "", "unitPrice": 0}


class SalesOrderLine(BaseModel):
    lineObjectNumber: str = Field(..., description="Item Number in BC")
    quantity: float = Field(..., description="Quantity to order")


class InsertSORequest(BaseModel):
    company_name: str
    customer_id: str
    external_doc_no: str = ""
    sales_order_lines: List[SalesOrderLine]
    comments: str = ""


@app.post("/api/insert_so_into_bc")
async def insert_so_into_bc(req: InsertSORequest):
    try:
        result = bc_auth.insert_sales_order(
            req.company_name,
            req.customer_id,
            req.external_doc_no,
            [line.dict() for line in req.sales_order_lines],
            req.comments,
        )
        return result or {"status": "ok"}
    except Exception as e:
        logger.exception(f"Error inserting sales order: {e}")
        return {"status": "error", "message": str(e)}

# ----------------------------------------
# App Entrypoint
# ----------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the FastAPI application.")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host address to bind the server.")
    parser.add_argument("--port", type=int, default=8000, help="Port number to bind the server.")
    args = parser.parse_args()
    try:
        uvicorn.run(app, host=args.host, port=args.port)
    except Exception as e:
        logger.exception(f"Failed to start Uvicorn server: {e}")
