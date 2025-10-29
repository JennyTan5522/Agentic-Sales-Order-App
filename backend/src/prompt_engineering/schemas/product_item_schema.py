from typing import List
from pydantic import BaseModel, Field
from langchain_core.output_parsers import PydanticOutputParser

class ProductItem(BaseModel):
    number: str = Field(..., description="Item number")
    displayName: str = Field(..., description="Item display name")
    itemCategoryCode: str = Field(..., description="Item category code")
    unitPrice: float = Field(..., description="Unit price of the item")
    model_config = {"arbitrary_types_allowed": True}

class ProductItemSearchResults(BaseModel):
    items: List[ProductItem] = Field(..., description="List of matching product items")
    model_config = {"arbitrary_types_allowed": True}

product_item_search_parser = PydanticOutputParser(pydantic_object=ProductItemSearchResults)