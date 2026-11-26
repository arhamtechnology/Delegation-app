import { redirect } from 'next/navigation';

// FMS is a group of flows; Order FMS is the first.
export default function FmsPage() {
  redirect('/fms/order');
}
