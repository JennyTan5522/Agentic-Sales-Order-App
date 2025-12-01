from typing import Optional, Literal
from pydantic import BaseModel, Field

CountryCodeLiteral = Literal[
    "AE",      # UNITED ARAB EMIRATES
    "AT",      # AUSTRIA
    "AUS",     # AUSTRALIA
    "BE",      # BELGIUM
    "BG",      # BULGARIA
    "BR",      # BRAZIL
    "BRN",     # BRUNEI DARUSSALAM
    "CA",      # CANADA
    "CH",      # SWITZERLAND
    "CN",      # CHINA
    "CY",      # CYPRUS
    "CZ",      # CZECH REPUBLIC
    "DE",      # GERMANY
    "DK",      # DENMARK
    "DZ",      # ALGERIA
    "EE",      # ESTONIA
    "EL",      # GREECE
    "ES",      # SPAIN
    "EU",      # EUROPE
    "FI",      # FINLAND
    "FJ",      # FIJI ISLANDS
    "FR",      # FRANCE
    "GB",      # GREAT BRITAIN
    "HK",      # HONG KONG
    "HR",      # CROATIA
    "HU",      # HUNGARY
    "IE",      # IRELAND
    "IN",      # INDIA
    "IND",     # INDONESIA
    "IS",      # ICELAND
    "IT",      # ITALY
    "JP",      # JAPAN
    "KE",      # KENYA
    "KH",      # CAMBODIA
    "LT",      # LITHUANIA
    "LU",      # LUXEMBOURG
    "LV",      # LATVIA
    "MA",      # MOROCCO
    "ME",      # MONTENEGRO
    "MT",      # MALTA
    "MX",      # MEXICO
    "MY",      # MALAYSIA
    "MYANMAR", # MYANMAR
    "MZ",      # MOZAMBIQUE
    "NG",      # NIGERIA
    "NL",      # NETHERLANDS
    "NO",      # NORWAY
    "NZ",      # NEW ZEALAND
    "PH",      # PHILIPPINES
    "PL",      # POLAND
    "PT",      # PORTUGAL
    "RO",      # ROMANIA
    "RS",      # SERBIA
    "RU",      # RUSSIA
    "SA",      # SAUDI ARABIA
    "SB",      # SOLOMON ISLANDS
    "SE",      # SWEDEN
    "SG",      # SINGAPORE
    "SI",      # SLOVENIA
    "SK",      # SLOVAKIA
    "SRL",     # SRI LANKA
    "SZ",      # SWAZILAND
    "TH",      # THAILAND
    "TN",      # TUNISIA
    "TR",      # TURKEY
    "TZ",      # TANZANIA
    "UG",      # UGANDA
    "US",      # USA
    "VN",      # VIETNAM
    "VU",      # VANUATU
    "WS",      # SAMOA
    "ZA",      # SOUTH AFRICA
]
class SalesOrderItem(BaseModel):
    fabric_name: str = Field(..., description="Name of the fabric ordered")
    quantity: float = Field(..., description="Quantity ordered (float value)")
    discount: Optional[float] = Field(None, description="Discount percentage (e.g., 10 for 10%)")
    model_config = {"arbitrary_types_allowed": True}

class SalesOrderOutputFormat(BaseModel):
    customer_name: str = Field(..., description="Customer Name")
    external_document_number: Optional[str] = Field(None, description="External Document Number (PO/Ref)")
    shipping_address_line1: Optional[str] = Field(None, description="First line of the street address for shipping.")
    shipping_address_line2: Optional[str] = Field(None, description="Second line of the street address or apartment/suite number for shipping.")
    shipping_city: Optional[str] = Field(None, description="City for the shipping address.")
    shipping_state: Optional[str] = Field(None, description="State, Province, or Region for the shipping address.")
    shipping_country: Optional[CountryCodeLiteral] = Field(None, description="Country for the shipping address.")
    shipping_postalCode: Optional[str] = Field(None, description="Postal code or ZIP code for the shipping address.")
    items: list[SalesOrderItem] = Field(..., description="List of ordered fabrics and quantities")
    notes: str = Field(..., description="Remarks/suggestions for staff")
    model_config = {"arbitrary_types_allowed": True}