from typing import List
from pydantic import BaseModel, Field
from langchain_core.output_parsers import PydanticOutputParser

class CustomerInfo(BaseModel):
    number: str = Field(..., description="Customer number")
    displayName: str = Field(..., description="Customer display name")
    addressLine1: str = Field(..., description="Customer address line 1")
    addressLine2: str = Field(..., description="Customer address line 2")
    city: str = Field(..., description="Customer city")
    state: str = Field(..., description="Customer state")
    country: str = Field(..., description="Customer country")
    postalCode: str = Field(..., description="Customer postal code")
    phoneNumber: str = Field(..., description="Customer phone number")
    email: str = Field(..., description="Customer email address")
    model_config = {"arbitrary_types_allowed": True}

class CustomerSearchResults(BaseModel):
    customers: List[CustomerInfo] = Field(..., description="List of matching customers")
    model_config = {"arbitrary_types_allowed": True}

customer_search_parser=PydanticOutputParser(pydantic_object=CustomerSearchResults)