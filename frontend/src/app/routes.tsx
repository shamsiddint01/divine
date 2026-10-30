import { lazy, Suspense } from 'react';
import type { RouteObject } from 'react-router';
import { RequireAuth, SessionLoader } from '@/features/session/components/RequireAuth';
import { AppLayout } from './layouts/AppLayout';
import { NotFoundPage } from './pages/NotFoundPage';
import { RouteErrorPage } from './pages/RouteErrorPage';

// Sahifalar lazy yuklanadi (code splitting): boshlang'ich bundle kichik bo'ladi.
const page = <T extends Record<string, React.ComponentType>>(
  load: () => Promise<T>,
  name: keyof T,
) => lazy(async () => ({ default: (await load())[name] as React.ComponentType }));

const LoginPage = page(() => import('@/features/session/pages/LoginPage'), 'LoginPage');
const DashboardPage = page(
  () => import('@/features/dashboard/pages/DashboardPage'),
  'DashboardPage',
);
const UsersPage = page(() => import('@/features/users/pages/UsersPage'), 'UsersPage');
const ProductsPage = page(() => import('@/features/products/pages/ProductsPage'), 'ProductsPage');
const ProductGroupsPage = page(
  () => import('@/features/product-groups/pages/ProductGroupsPage'),
  'ProductGroupsPage',
);
const WarehousesPage = page(
  () => import('@/features/warehouses/pages/WarehousesPage'),
  'WarehousesPage',
);
const WarehouseDetailPage = page(
  () => import('@/features/warehouses/pages/WarehouseDetailPage'),
  'WarehouseDetailPage',
);
const SalesPage = page(() => import('@/features/sales/pages/SalesPage'), 'SalesPage');
const CustomersPage = page(
  () => import('@/features/customers/pages/CustomersPage'),
  'CustomersPage',
);
const CustomerDetailPage = page(
  () => import('@/features/customers/pages/CustomerDetailPage'),
  'CustomerDetailPage',
);
const IncomingPage = page(() => import('@/features/incoming/pages/IncomingPage'), 'IncomingPage');
const IncomingEditorPage = page(
  () => import('@/features/incoming/pages/IncomingEditorPage'),
  'IncomingEditorPage',
);
const ExpensesPage = page(() => import('@/features/expenses/pages/ExpensesPage'), 'ExpensesPage');
const ReportsPage = page(() => import('@/features/reports/pages/ReportsPage'), 'ReportsPage');
const SettingsPage = page(() => import('@/features/settings/pages/SettingsPage'), 'SettingsPage');

export const routes: RouteObject[] = [
  {
    path: '/login',
    element: (
      <Suspense fallback={<SessionLoader />}>
        <LoginPage />
      </Suspense>
    ),
    errorElement: <RouteErrorPage />,
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'users', element: <UsersPage /> },
      { path: 'products', element: <ProductsPage /> },
      { path: 'product-groups', element: <ProductGroupsPage /> },
      { path: 'warehouses', element: <WarehousesPage /> },
      { path: 'warehouses/:id', element: <WarehouseDetailPage /> },
      { path: 'sales', element: <SalesPage /> },
      { path: 'customers', element: <CustomersPage /> },
      { path: 'customers/:id', element: <CustomerDetailPage /> },
      { path: 'incoming', element: <IncomingPage /> },
      { path: 'incoming/new', element: <IncomingEditorPage /> },
      { path: 'incoming/:id', element: <IncomingEditorPage /> },
      { path: 'expenses', element: <ExpensesPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
