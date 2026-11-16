# Gifts & Donations Dashboard

A live dashboard on Incorta's **BSGiftsDonations** business view (`New_View`), built as a Claude Data artifact.

Live version: https://claude.ai/artifact/2sJYUn11F6TdFSgX629KCq

## Files

| File | What it is |
|---|---|
| `index.html` | The dashboard page: layout, styles, the loader, the calculations and the chart drawing code |
| `dashboard.json` | The dashboard's title, filter defaults and its one live dataset (the Incorta query) |

## Data source

One live query, run each time the dashboard is opened, with the viewer's own Incorta access:

- **Connector:** Incorta MCP
- **Tool:** `query_business_view`
- **View:** `BSGiftsDonations.New_View` (built over physical table `GiftsDonations.gifts_donations`, 1,566 rows)
- **Grain:** sum and count of `inv_dist_amount` by `invoice_date`, `vendor_name`, `vendor_type`, `ou_name` (about 200 rows)

Everything else is worked out in the page from that one result, so the filters respond without calling Incorta again.

## What it shows

- Takeaway sentence: the top vendor and its share of total spend
- Headline figures: total spend, invoice lines, vendor count, average per line
- Spend by invoice year (1997–2010)
- Spend by vendor, by operating unit and by vendor type
- Vendor detail table: type, lines, spend, share
- Filters: vendor type and operating unit

## Notes on the numbers

- **Spend = `inv_dist_amount`.** `invoice_amount` is not summed because it repeats on every distribution line of an invoice and would overstate the total.
- Some lines are reversals, so a vendor or year can net to less than its gross bookings.
- All rows are country `AMERICA`. The `hcp_classif`, `reportble_supp`, `parent_dept` and `parent_dept_desc` fields are empty, so they aren't shown.
- One vendor (Building Management Inc.) has no vendor type; it shows as `(blank)`.

## Prerequisites

- The **Incorta MCP** connector in claude.ai, configured with the environment URL, tenant and token.
- Read access to the `BSGiftsDonations` schema.
- `run_sql` (Spark SQL) also needs `INCORTA_USERNAME` set on the connector. This dashboard doesn't use it.
