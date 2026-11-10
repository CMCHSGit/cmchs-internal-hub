/* The old New equipment page (/new-equipment/). Its customer picker, recorded assets and asset list are now the Customers tab of the
   Test Bench (./Customers.jsx, opened from ../section.jsx), so this only sends people there: old links, bookmarks and the Service menu
   keep working. */
import { useEffect } from 'react'
import { Loading } from '../../../../shared/ui/index.jsx'

export const CUSTOMERS_URL = '/testbench/?tab=customers'

export default function NewEquipmentSection() {
  useEffect(() => { location.replace(CUSTOMERS_URL) }, [])
  return <div style={{ padding: 24 }}><Loading /><p>This page has moved into the Test Bench’s Customers tab. <a href={CUSTOMERS_URL}>Open it</a> if you are not taken there.</p></div>
}
