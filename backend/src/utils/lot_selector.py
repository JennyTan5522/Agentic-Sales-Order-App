import pandas as pd
from src.utils.logger import get_logger

logger = get_logger(__name__)

class LotSelector:
    """
    Desc:
        A class to perform FIFO lot selection and allocation from available lots.
        This helps determine which lots to use based on their posting dates (oldest first).

    Attributes:
        available_lots (pd.DataFrame): DataFrame containing available lots.
        selected_lots (list[dict]): Stores selected lots and their allocated quantities.
    """

    def __init__(self, available_lots: pd.DataFrame):
        """
        Desc:
            Initialize LotSelector with available lots DataFrame.

        Args:
            available_lots (pd.DataFrame): 
                DataFrame with columns ['Lot_No', 'Remaining_Quantity', 'Posting_Date'].
                The 'Posting_Date' column will be converted to datetime format.

        Raises:
            TypeError: If available_lots is not a pandas DataFrame.
            ValueError: If required columns are missing.
        """
        try:
            if not isinstance(available_lots, pd.DataFrame):
                raise TypeError("available_lots must be a pandas DataFrame")

            required_columns = {'Lot_No', 'Remaining_Quantity', 'Posting_Date'}
            if not required_columns.issubset(available_lots.columns):
                raise ValueError(f"available_lots must contain columns: {required_columns}")

            # Ensure Posting_Date is datetime
            available_lots['Posting_Date'] = pd.to_datetime(available_lots['Posting_Date'], errors='coerce')
            if available_lots['Posting_Date'].isna().any():
                raise ValueError("Invalid date format found in 'Posting_Date' column")

            # Sort FIFO (oldest first)
            self.available_lots = available_lots.sort_values(by="Posting_Date").reset_index(drop=True)
            self.selected_lots = []

            logger.info("LotSelector initialized successfully with %d lots.", len(self.available_lots))

        except Exception as e:
            logger.exception(f"Failed to initialize LotSelector: {e}")
            raise

    def allocate(self, required_qty: float) -> list[dict]:
        """
        Desc:
            Allocate lots based on FIFO (oldest posting date first)
            until the required quantity is fulfilled or all lots are used.

        Args:
            required_qty (float): 
                Total quantity needed for allocation.

        Returns:
            list[dict]: 
                A list of selected lots with the following keys:
                - 'Lot_No': Lot number
                - 'Available_Qty': Quantity available in the lot
                - 'Allocated_Qty': Quantity taken from this lot
                - 'Remaining_After': Remaining quantity after allocation
                - 'Posting_Date': The posting date of the lot

        Raises:
            ValueError: If required_qty is less than or equal to zero.
        """
        try:
            if required_qty <= 0:
                raise ValueError("required_qty must be greater than zero")

            remaining_to_allocate = required_qty
            logger.info("Starting FIFO allocation for %.2f meters.", required_qty)

            for index, lot in self.available_lots.iterrows():
                if remaining_to_allocate <= 0:
                    break

                lot_no = lot['Lot_No']
                available = float(lot['Remaining_Quantity'])
                posting_date = lot['Posting_Date'].strftime("%Y-%m-%d")

                logger.info("Processing Lot: %s | Available: %.2f | Remaining to allocate: %.2f", 
                            lot_no, available, remaining_to_allocate)

                # Determine allocation amount
                qty_to_take = min(available, remaining_to_allocate)
                if available >= remaining_to_allocate:
                    logger.info("Taking %.2f meters from lot %s (allocation complete).", qty_to_take, lot_no)
                else:
                    logger.info("Taking all %.2f meters from lot %s (insufficient to fulfill).", qty_to_take, lot_no)

                # Record the selection
                self.selected_lots.append({
                    'Lot_No': lot_no,
                    'Available_Qty': available,
                    'Allocated_Qty': qty_to_take,
                    'Remaining_After': available - qty_to_take,
                    'Posting_Date': posting_date
                })

                # Update remaining quantity
                remaining_to_allocate -= qty_to_take
                logger.info("After taking: %.2f meters still needed.", remaining_to_allocate)

            if remaining_to_allocate > 0:
                logger.warning("Allocation incomplete: %.2f meters still unfulfilled (insufficient stock).", remaining_to_allocate)
            else:
                logger.info("Allocation completed successfully for %.2f meters.", required_qty)

            return self.selected_lots

        except Exception as e:
            logger.exception(f"Error during allocation: {e}")
            raise


# Example usage:
# if __name__ == "__main__":
#     data = {
#         'Lot_No': ['L001', 'L002', 'L003'],
#         'Remaining_Quantity': [100, 50, 70],
#         'Posting_Date': ['2025-01-10', '2025-01-15', '2025-01-20']
#     }
#     df = pd.DataFrame(data)

#     selector = LotSelector(df)
#     results = selector.allocate(required_qty=160)

#     logger.info("Selected lots summary:\n%s", pd.DataFrame(results))
