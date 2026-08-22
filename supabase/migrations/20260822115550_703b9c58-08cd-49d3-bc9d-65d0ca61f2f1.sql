UPDATE public.project_files
SET content = 'import { Outlet } from "@/components/ui/router";
import { Hero } from "@/components/sections/Hero";
import { SocialProof } from "@/components/sections/SocialProof";

function Home() {
  return (
    <main>
      <Hero />
      <SocialProof />
      <Outlet />
    </main>
  );
}

export default Home;
export { Home };
'
WHERE project_id = '4bf66fc6-7917-4339-995e-59ce397d7d6f'
  AND path = 'src/pages/Home.tsx';