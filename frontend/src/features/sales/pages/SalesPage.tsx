import { History, ShoppingCart } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { t } from '@/i18n/uz';
import { PageHeader } from '@/shared/components/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { PosView } from '../components/PosView';
import { SalesHistoryView } from '../components/SalesHistoryView';

export function SalesPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'history' ? 'history' : 'pos';

  return (
    <>
      <PageHeader title={t.nav.sales} description={t.sales.description} />
      <Tabs
        value={tab}
        onValueChange={(v) => setParams(v === 'pos' ? {} : { tab: v }, { replace: true })}
      >
        <TabsList>
          <TabsTrigger value="pos">
            <ShoppingCart />
            {t.sales.tabs.pos}
          </TabsTrigger>
          <TabsTrigger value="history">
            <History />
            {t.sales.tabs.history}
          </TabsTrigger>
        </TabsList>
        {/* Savat holati tab almashganda yo'qolmasligi uchun POS doim yuklangan turadi */}
        <TabsContent value="pos" forceMount className="data-[state=inactive]:hidden">
          <PosView />
        </TabsContent>
        <TabsContent value="history">
          <SalesHistoryView />
        </TabsContent>
      </Tabs>
    </>
  );
}
