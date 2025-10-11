import bgIndex from "@/assets/bg-index.jpg";

const Index = () => {
  return (
    <div 
      className="flex min-h-screen items-center justify-center relative"
      style={{
        backgroundImage: `url(${bgIndex})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed'
      }}
    >
      <div className="absolute inset-0 bg-black/50"></div>
      <div className="text-center relative z-10">
        <h1 className="mb-4 text-4xl font-bold text-white">Welcome to Container Yard Management</h1>
        <p className="text-xl text-white/90">Professional maritime logistics and container tracking system</p>
      </div>
    </div>
  );
};

export default Index;
