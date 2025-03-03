import './globals.css';
import { Inter } from 'next/font/google';
import { AntdRegistry } from '@ant-design/nextjs-registry';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: '高考志愿推荐',
  description: '高考志愿填报智能推荐系统',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body className={inter.className}>
        <AntdRegistry>
          <div className="min-h-screen bg-gray-50 flex flex-col">
            <header className="bg-white shadow-sm p-4">
              <h1 className="text-xl font-bold">高考志愿推荐</h1>
            </header>
            <main className="flex-1 p-4 overflow-auto">
              {children}
            </main>
          </div>
        </AntdRegistry>
      </body>
    </html>
  );
} 