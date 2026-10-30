import { Link } from 'react-router';
export function BookingLink({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link className={className} to="/enquiry">
      {children}
    </Link>
  );
}
