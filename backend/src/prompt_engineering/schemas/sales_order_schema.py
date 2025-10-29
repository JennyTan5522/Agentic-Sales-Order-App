from typing import Optional
from pydantic import BaseModel, Field

class SalesOrderItem(BaseModel):
    fabric_name: str = Field(..., description="Name of the fabric ordered")
    quantity: float = Field(..., description="Quantity ordered (float value)")
    discount: Optional[float] = Field(None, description="Discount percentage (e.g., 10 for 10%)")
    model_config = {"arbitrary_types_allowed": True}

class SalesOrderOutputFormat(BaseModel):
    customer_name: str = Field(..., description="Customer Name")
    external_document_number: Optional[str] = Field(None, description="External Document Number (PO/Ref)")
    shipping_address: Optional[str] = Field(None, description="Shipping Address")
    items: list[SalesOrderItem] = Field(..., description="List of ordered fabrics and quantities")
    notes: str = Field(..., description="Remarks/suggestions for staff")
    model_config = {"arbitrary_types_allowed": True}