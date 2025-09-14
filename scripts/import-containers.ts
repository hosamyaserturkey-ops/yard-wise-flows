import { supabase } from '@/integrations/supabase/client';

interface ContainerData {
  containerNumber: string;
  containerSize: string;
  entryDate: string;
  status: string;
  grade?: string;
  bookingNumber?: string;
  truckNumber?: string;
  exitDate?: string;
  shippingLine: string;
  notes?: string;
}

// Sample container data from the Excel file
const containerData: ContainerData[] = [
  {
    containerNumber: "JZPU7007704",
    containerSize: "40 HQ",
    entryDate: "20-Jul-25",
    status: "Shipped Out",
    bookingNumber: "EVEREST Transport To ACT",
    truckNumber: "0",
    exitDate: "1-Aug-25",
    shippingLine: "OSC"
  },
  {
    containerNumber: "SLVU1004808",
    containerSize: "20",
    entryDate: "23-Jul-25",
    status: "YARD",
    grade: "A",
    shippingLine: "SLD"
  },
  {
    containerNumber: "SLVU3007344",
    containerSize: "20",
    entryDate: "23-Jul-25",
    status: "YARD",
    grade: "A",
    shippingLine: "SLD"
  },
  {
    containerNumber: "HMCU3031900",
    containerSize: "20",
    entryDate: "23-Jul-25",
    status: "Shipped Out",
    grade: "C",
    bookingNumber: "EVEREST Transport To ACT",
    truckNumber: "6054786",
    exitDate: "8/8/25",
    shippingLine: "SLD",
    notes: "26 ON Kawar + 25 Transportation"
  },
  {
    containerNumber: "BXAU4574656",
    containerSize: "40 HQ",
    entryDate: "23-Jul-25",
    status: "YARD",
    grade: "A",
    shippingLine: "SLD"
  },
  {
    containerNumber: "EISU9067936",
    containerSize: "40 HQ",
    entryDate: "24-Jul-25",
    status: "Shipped Out",
    bookingNumber: "EVEREST Transport To ACT",
    truckNumber: "6033448",
    exitDate: "3-Aug-25",
    shippingLine: "SLD",
    notes: "Loading fees 26 + Transportation 50"
  },
  {
    containerNumber: "VSTU9908411",
    containerSize: "40 HQ",
    entryDate: "24-Jul-25",
    status: "YARD",
    grade: "A",
    shippingLine: "SLD"
  },
  {
    containerNumber: "TCNU9048422",
    containerSize: "40 HQ",
    entryDate: "24-Jul-25",
    status: "Shipped Out",
    bookingNumber: "EVEREST Transport To ACT",
    truckNumber: "6093001",
    exitDate: "3-Aug-25",
    shippingLine: "SLD",
    notes: "Loading fees 26 + Transportation 50"
  },
  {
    containerNumber: "SLVU5022409",
    containerSize: "40 HQ",
    entryDate: "24-Jul-25",
    status: "RESERVED",
    truckNumber: "000201",
    shippingLine: "SLD"
  },
  {
    containerNumber: "XHCU5635102",
    containerSize: "40 HQ",
    entryDate: "24-Jul-25",
    status: "RESERVED",
    truckNumber: "000202",
    shippingLine: "SLD"
  }
];

const parseDate = (dateStr: string): Date => {
  // Handle various date formats from the Excel file
  if (dateStr.includes('-Jul-25')) {
    const day = dateStr.split('-')[0];
    return new Date(2025, 6, parseInt(day)); // July is month 6
  } else if (dateStr.includes('-Aug-25')) {
    const day = dateStr.split('-')[0];
    return new Date(2025, 7, parseInt(day)); // August is month 7
  } else if (dateStr.includes('/8/25')) {
    const parts = dateStr.split('/');
    return new Date(2025, 7, parseInt(parts[1])); // August
  }
  
  // Fallback - try to parse as is
  return new Date(dateStr);
};

const mapContainerType = (size: string): string => {
  if (size.includes('20')) return '20FT';
  if (size.includes('40 HQ') || size.includes('40HQ')) return '40HC';
  if (size.includes('40 OT') || size.includes('40OT')) return '40FT';
  if (size.includes('40FL')) return '40FT';
  if (size.includes('40')) return '40FT';
  return '20FT'; // Default
};

const mapStatus = (status: string): 'in-yard' | 'out' => {
  if (status.toLowerCase().includes('yard') || status.toLowerCase().includes('reserved')) {
    return 'in-yard';
  }
  return 'out';
};

const mapShippingLine = (line: string): 'SLD' | 'SLG' => {
  return line === 'SLD' ? 'SLD' : 'SLG';
};

const calculateFees = (notes?: string): number => {
  if (!notes) return 0;
  
  // Extract fees from notes
  if (notes.includes('26 ON Kawar + 50 Transportation')) return 76;
  if (notes.includes('26 ON Kawar + 25 Transportation')) return 51;
  if (notes.includes('Loading fees 26 + Transportation 50')) return 76;
  if (notes.includes('Loading Fees + Booking 36')) return 36;
  if (notes.includes('Loading fees 36')) return 36;
  
  return 0;
};

export const importContainers = async (): Promise<{ success: number; errors: string[] }> => {
  const results = { success: 0, errors: [] as string[] };
  
  // Get current user
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    results.errors.push('No authenticated user found');
    return results;
  }

  for (const container of containerData) {
    try {
      const gateInTime = parseDate(container.entryDate);
      const gateOutTime = container.exitDate ? parseDate(container.exitDate) : null;
      
      const containerRecord = {
        container_number: container.containerNumber,
        container_type: mapContainerType(container.containerSize),
        shipping_line: mapShippingLine(container.shippingLine),
        driver_name: 'Unknown Driver', // Default value since not in Excel
        truck_number: container.truckNumber || 'Unknown',
        gate_in_time: gateInTime.toISOString(),
        gate_out_time: gateOutTime?.toISOString() || null,
        status: mapStatus(container.status),
        booking_number: container.bookingNumber || null,
        fees: calculateFees(container.notes),
        created_by: user.id
      };

      const { error } = await supabase
        .from('containers')
        .insert(containerRecord);

      if (error) {
        results.errors.push(`Failed to insert ${container.containerNumber}: ${error.message}`);
      } else {
        results.success++;
      }
    } catch (err) {
      results.errors.push(`Error processing ${container.containerNumber}: ${err}`);
    }
  }

  return results;
};

// Function to import all containers from the full dataset
export const importAllContainersFromExcel = async (): Promise<{ success: number; errors: string[] }> => {
  // This would contain the full 600+ container records from the Excel file
  // For now, we'll just import the sample data above
  return await importContainers();
};