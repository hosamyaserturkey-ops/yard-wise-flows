import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, CheckCircle, AlertCircle, FileSpreadsheet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { importAllContainersFromExcel } from "../../scripts/import-containers-full";
import bgImport from "@/assets/bg-import.jpg";

const ImportContainers = () => {
  const { toast } = useToast();
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<{
    success: number;
    errors: string[];
  } | null>(null);

  const handleImport = async () => {
    setImporting(true);
    setImportResults(null);

    try {
      const results = await importAllContainersFromExcel();
      setImportResults(results);
      
      if (results.success > 0) {
        toast({
          title: "Import Completed",
          description: `Successfully imported ${results.success} containers`,
          variant: "default",
        });
      }
      
      if (results.errors.length > 0) {
        toast({
          title: "Import Issues",
          description: `${results.errors.length} containers failed to import`,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Import error:', error);
      toast({
        title: "Import Failed",
        description: "An error occurred during import",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div 
      className="min-h-screen relative py-6"
      style={{
        backgroundImage: `url(${bgImport})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed'
      }}
    >
      <div className="absolute inset-0 bg-black/50"></div>
      <div className="space-y-6 relative z-10">
      <div className="flex items-center space-x-2">
        <FileSpreadsheet className="h-8 w-8 text-maritime" />
        <h1 className="text-3xl font-bold text-industrial">Import Containers</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Upload className="h-5 w-5" />
            <span>Excel Data Import</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            This will import container data from the uploaded Excel file (Empty_Containers_Report_-_Kawar_NEW.xlsx).
            The system will automatically map the data to the appropriate fields.
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold">Data Mapping:</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Container numbers will be imported as-is</li>
              <li>• Container sizes will be mapped to standard types (20FT, 40FT, 40HC)</li>
              <li>• Status will be mapped to "in-yard" or "out"</li>
              <li>• Shipping lines will be mapped to SLD or SLG</li>
              <li>• Fees will be calculated from notes when available</li>
              <li>• Dates will be converted to proper timestamps</li>
            </ul>
          </div>

          <Button 
            onClick={handleImport} 
            disabled={importing}
            className="bg-maritime hover:bg-maritime/90"
          >
            {importing ? (
              <>
                <Upload className="h-4 w-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Import Container Data
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {importResults && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              {importResults.success > 0 ? (
                <CheckCircle className="h-5 w-5 text-success" />
              ) : (
                <AlertCircle className="h-5 w-5 text-destructive" />
              )}
              <span>Import Results</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-success/10 rounded-lg">
                <div className="text-2xl font-bold text-success">{importResults.success}</div>
                <div className="text-sm text-muted-foreground">Successfully Imported</div>
              </div>
              <div className="p-4 bg-destructive/10 rounded-lg">
                <div className="text-2xl font-bold text-destructive">{importResults.errors.length}</div>
                <div className="text-sm text-muted-foreground">Failed to Import</div>
              </div>
            </div>

            {importResults.errors.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold text-destructive">Import Errors:</h4>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {importResults.errors.map((error, index) => (
                    <div key={index} className="text-sm text-muted-foreground bg-destructive/5 p-2 rounded">
                      {error}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
};

export default ImportContainers;