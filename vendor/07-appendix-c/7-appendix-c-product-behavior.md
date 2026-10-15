# 7 Appendix C: Product Behavior

> Source: [MS-RDL] v20251031 — pages PDF 1635–1648.
> Extraction textuelle : les tableaux complexes et diagrammes vectoriels peuvent nécessiter le PDF source.

7
Appendix C: Product Behavior
The information in this specification is applicable to the following Microsoft products or supplemental
software. References to product versions include updates to those products.
Microsoft SQL Server 2000

Microsoft SQL Server 2005

Microsoft SQL Server 2008

Microsoft SQL Server 2008 R2

Microsoft SQL Server 2012

Microsoft SQL Server 2014

Microsoft SQL Server 2016

Microsoft SQL Server 2017

Microsoft SQL Server 2019

Microsoft SQL Server 2022

Microsoft SQL Server 2025

Exceptions, if any, are noted in this section. If an update version, service pack or Knowledge Base
(KB) number appears with a product name, the behavior changed in that update. The new behavior
also applies to subsequent updates unless otherwise specified. If a product edition appears with the
product version, behavior is different in that product edition.
Unless otherwise specified, any statement of optional behavior in this specification that is prescribed
using the terms "SHOULD" or "SHOULD NOT" implies product behavior in accordance with the
SHOULD or SHOULD NOT prescription. Unless otherwise specified, the term "MAY" implies that the
product does not follow the prescription.
<1> Section 1.6: The following table describes RDL versions and when they were introduced. Newer
releases of Microsoft SQL Server Reporting Services support previous RDL versions. For example,
Microsoft SQL Server 2022 Reporting Services supports all previous RDL versions.
RDL schema version
Release introduced
RDL 2003/10
Microsoft SQL Server 2000 Reporting Services
RDL 2005/01
Microsoft SQL Server 2005 Reporting Services
RDL 2008/01
Microsoft SQL Server 2008 Reporting Services
RDL 2010/01
Microsoft SQL Server 2008 R2 Reporting Services
RDL 2011/01
Microsoft SQL Server 2012 Reporting Services
RDL 2012/01
Microsoft SQL Server 2012 Service Pack 1 (SP1) Reporting Services
RDL 2013/01
SQL Server 2012 SP1 Reporting Services
RDL 2016/01
Microsoft SQL Server 2016 Reporting Services
<2> Section 2.2.7: The file format validation implementation in SQL Server 2000 Reporting Services
and SQL Server 2005 Reporting Services restricts sizes to a maximum of 160 inches or the equivalent.
Otherwise, Reporting Services restricts sizes to a maximum of 455 inches or the equivalent.
<3> Section 2.3.7: In the Microsoft implementation, the code is specified in a Visual Basic–compatible
syntax [MSFT-VBNET].
<4> Section 2.7.1: The value of the Body.Columns element is less than or equal to 1000.
<5> Section 2.8.1: The value of the Page.Columns element is less than or equal to 1000.
<6> Section 2.18.3: The value of the Paragraph.ListLevel element is less than or equal to 9.
<7> Section 2.23.10: In the file format validation implementation of Tablix.DataSetName in SQL
Server 2000 Reporting Services, SQL Server 2005 Reporting Services, SQL Server 2008 Reporting
Services, and SQL Server 2008 R2 Reporting Services, if DataRegion has an ancestor, the value of
the DataSetName element is ignored. The value of DataSetName of the data region's ancestor is
used instead.
<8> Section 2.23.18: The file format validation implementation in Reporting Services requires that
Tablix.LayoutDirection be set to "LTR" if the Tablix.BandLayoutOptions element is present. This
behavior does not apply to SQL Server 2000 Reporting Services, SQL Server 2005 Reporting Services,
SQL Server 2008 Reporting Services, and SQL Server 2008 R2 Reporting Services.
<9> Section 2.30.2: The uniqueness and content of TablixCell.DataElementName is not required
for the RDL format but is a Microsoft implementation that is enforced during data rendering to ensure
a useable data extract.
<10> Section 2.30.4: The file format validation implementation in Reporting Services requires that
TablixCell.DataSetName not be specified unless TablixCell has both a containing row group and a
containing column group. This behavior does not apply to SQL Server 2000 Reporting Services, SQL
Server 2005 Reporting Services, SQL Server 2008 Reporting Services, and SQL Server 2008 R2
Reporting Services.
<11> Section 2.30.4: The file format validation implementation in Reporting Services requires that
TablixCell.DataSetName does not specify the name of DataSet for the containing column group
unless the containing row group uses the same DataSet. This behavior does not apply to SQL Server
2000 Reporting Services, SQL Server 2005 Reporting Services, SQL Server 2008 Reporting Services,
and SQL Server 2008 R2 Reporting Services.
<12> Section 2.34.7: In Reporting Services, the TablixMember.KeepTogether element is
automatically set to true if the containing Tablix is a band (that is, if the Tablix.BandLayoutOptions
element is specified) and if the TablixMember.KeepTogether element is not set to true already.
This behavior does not apply to SQL Server 2000 Reporting Services, SQL Server 2005 Reporting
Services, SQL Server 2008 Reporting Services, and SQL Server 2008 R2 Reporting Services.
<13> Section 2.81.9: The file format validation implementation in Reporting Services requires that a
grouping does not use DomainScopes and Parent expressions when NaturalGroup is specified. This
behavior does not apply to SQL Server 2000 Reporting Services, SQL Server 2005 Reporting Services,
SQL Server 2008 Reporting Services, and SQL Server 2008 R2 Reporting Services.
<14> Section 2.81.9: The file format validation implementation in Reporting Services requires that
when Group specifies NaturalGroup, the containing Group specifies NaturalGroup. This behavior
does not apply to SQL Server 2000 Reporting Services, SQL Server 2005 Reporting Services, SQL
Server 2008 Reporting Services, and SQL Server 2008 R2 Reporting Services.
<15> Section 2.81.9: The file format validation implementation in Reporting Services requires that
two or more groupings associated with DataSet do not describe conflicting NaturalGroup
requirements. A grouping without an ancestor/descendent relationship associated with the same
dataset can use NaturalGroup only if that grouping defines the same sequence of
GroupExpression. This behavior does not apply to SQL Server 2000 Reporting Services, SQL Server
2005 Reporting Services, SQL Server 2008 Reporting Services, and SQL Server 2008 R2 Reporting
Services.
<16> Section 2.81.10: The file format validation implementation in Reporting Services requires that
Group.PageBreak not be specified if the containing Tablix is a band (that is, if the
Tablix.BandLayoutOptions element is specified). This behavior does not apply to SQL Server 2000
Reporting Services, SQL Server 2005 Reporting Services, SQL Server 2008 Reporting Services, and
SQL Server 2008 R2 Reporting Services.
<17> Section 2.84.2: The file format validation implementation in Reporting Services requires that
when NaturalSort is specified in a scope, the NaturalGroup flag for the containing Group is
specified as true. This behavior does not apply to SQL Server 2000 Reporting Services, SQL Server
2005 Reporting Services, SQL Server 2008 Reporting Services, and SQL Server 2008 R2 Reporting
Services.
<18> Section 2.84.2: The file format validation implementation in Reporting Services requires that
when a grouping specifies NaturalSort, the containing scope that is bound to the same DataSet
specifies NaturalSort. NaturalSort is only effective if all containing groups and data regions bound
to the same dataset use NaturalSort. This behavior does not apply to SQL Server 2000 Reporting
Services, SQL Server 2005 Reporting Services, SQL Server 2008 Reporting Services, and SQL Server
2008 R2 Reporting Services.
<19> Section 2.84.2: The file format validation implementation in Reporting Services requires that
two or more groupings associated with a DataSet do not describe conflicting NaturalSort
requirements. A grouping without an ancestor/descendent relationship that is associated with the
same dataset can use NaturalSort only if that grouping defines the same sequence of
SortExpression. This behavior does not apply to SQL Server 2000 Reporting Services, SQL Server
2005 Reporting Services, SQL Server 2008 Reporting Services, and SQL Server 2008 R2 Reporting
Services.
<20> Section 2.84.2: The file format validation implementation in Reporting Services requires that
when a grouping specifies both NaturalGroup and NaturalSort, GroupExpressions and
SortExpressions do not describe conflicting order requirements on the dataset. SortExpressions for
a grouping has to contain all GroupExpressions for the Group when both NaturalGroup and
NaturalSort are specified. This behavior does not apply to SQL Server 2000 Reporting Services, SQL
Server 2005 Reporting Services, SQL Server 2008 Reporting Services, and SQL Server 2008 R2
Reporting Services.
<21> Section 2.84.2: The file format validation implementation in Reporting Services requires that
the individual SortExpression elements in a grouping use the same value for their NaturalSort
attributes. This behavior does not apply to SQL Server 2000 Reporting Services, SQL Server 2005
Reporting Services, SQL Server 2008 Reporting Services, and SQL Server 2008 R2 Reporting Services.
<22> Section 2.88.24: In the file format validation implementation for Chart.DataSetName in SQL
Server 2000 Reporting Services, SQL Server 2005 Reporting Services, SQL Server 2008 Reporting
Services, and SQL Server 2008 R2 Reporting Services, if DataRegion has an ancestor, the value of
DataSetName element is ignored. The value of DataSetName of the data region’s ancestor is used
instead.
<23> Section 2.121.2: The value of the ChartAxisScaleBreak.CollapsibleSpaceThreshold
element is greater than or equal to 10 and less than or equal to 90.
<24> Section 2.121.5: The value of the ChartAxisScaleBreak.MaxNumberOfBreaks element is
less than or equal to 5.
<25> Section 2.121.6: The value of the ChartAxisScaleBreak.Spacing element is less than or equal
to 10.
<26> Section 2.128.2: The value of the ChartThreeDProperties.DepthRatio element is less than or
equal to 1000.
<27> Section 2.128.8: The value of the ChartThreeDProperties.Rotation element is greater than
or equal to -180 and less than or equal to 180.
<28> Section 2.128.10: The value of the ChartThreeDProperties.WallThickness element is less
than or equal to 30.
<29> Section 2.141.12: The file format validation implementation in Reporting Services requires that
ChartDataPoint.DataSetName not be specified unless ChartDataPoint has both a containing
category group and a containing series group. This behavior does not apply to SQL Server 2000
Reporting Services, SQL Server 2005 Reporting Services, SQL Server 2008 Reporting Services, and
SQL Server 2008 R2 Reporting Services.
<30> Section 2.141.12: The file format validation implementation in Reporting Services requires that
ChartDataPoint.DataSetName does not specify the name of the DataSet for the containing series
group unless the containing category group uses the same DataSet. This behavior does not apply to
SQL Server 2000 Reporting Services, SQL Server 2005 Reporting Services, SQL Server 2008
Reporting Services, and SQL Server 2008 R2 Reporting Services.
<31> Section 2.146.6: The value of the ChartSmartLabel.CalloutLineWidth element is greater
than or equal to 0.24985pt and less than or equal to 20pt.
<32> Section 2.152.8: The value of the ChartLegend.ColumnSpacing element is less than or equal
to 100.
<33> Section 2.163.17: In the file format validation implementation for GaugePanel.DataSetName
in SQL Server 2000 Reporting Services, SQL Server 2005 Reporting Services, SQL Server 2008
Reporting Services, and SQL Server 2008 R2 Reporting Services, if a DataRegion has an ancestor,
the value of the DataSetName element is ignored. The value of the DataSetName of the data
region’s ancestor is used instead.
<34> Section 2.177.3: The value of the CustomLabel.DistanceFromScale element is greater than
or equal to -100 and less than or equal to 100.
<35> Section 2.178.1: The value of the TickMarkStyle.DistanceFromScale element is greater than
or equal to -100 and less than or equal to 100.
<36> Section 2.178.5: The value of the TickMarkStyle.Length element is less than or equal to 100.
<37> Section 2.178.10: The value of the TickMarkStyle.Width element is less than or equal to 100.
<38> Section 2.180.3: The value of the GaugeTickMarks.DistanceFromScale element is greater
than or equal to -100 and less than or equal to 100.
<39> Section 2.180.7: The value of the GaugeTickMarks.Length element is less than or equal
to 100.
<40> Section 2.180.12: The value of the GaugeTickMarks.Width element is less than or equal
to 100.
<41> Section 2.182.4: The value of the LinearPointer.DistanceFromScale element is greater than
or equal to -100 and less than or equal to 100.
<42> Section 2.182.7: The value of the LinearPointer.MarkerLength element is less than or equal
to 100.
<43> Section 2.184.1: The value of the Thermometer.BulbOffset element is less than or equal
to 100.
<44> Section 2.184.2: The value of the Thermometer.BulbSize element is less than or equal
to 1000.
<45> Section 2.185.2: The value of the ScaleLabels.DistanceFromScale element is greater than or
equal to -100 and less than or equal to 100.
<46> Section 2.186.1: The value of the ScalePin.DistanceFromScale element is greater than or
equal to -100 and less than or equal to 100.
<47> Section 2.186.5: The value of the ScalePin.Length element is less than or equal to 100.
<48> Section 2.186.10: The value of the ScalePin.Width element is less than or equal to 100.
<49> Section 2.187.2: The value of the PinLabel.DistanceFromScale element is greater than or
equal to -100 and less than or equal to 100.
<50> Section 2.189.4: The value of the ScaleRange.DistanceFromScale element is greater than or
equal to -100 and less than or equal to 100.
<51> Section 2.189.6: The value of the ScaleRange.EndWidth element is less than or equal
to 1000.
<52> Section 2.189.13: The value of the ScaleRange.StartWidth element is less than or equal
to 1000.
<53> Section 2.200.4: The value of the RadialPointer.DistanceFromScale element is greater than
or equal to -100 and less than or equal to 100.
<54> Section 2.200.7: The value of the RadialPointer.MarkerLength element is less than or equal
to 100.
<55> Section 2.201.7: The value of the PointerCap.Width element is less than or equal to 1000.
<56> Section 2.216.2: In the file format validation implementation for
MapDataRegion.DataSetName in SQL Server 2000 Reporting Services, SQL Server 2005 Reporting
Services, SQL Server 2008 Reporting Services, and SQL Server 2008 R2 Reporting Services, if
DataRegion has an ancestor, the value of the DataSetName element is ignored. The value of
DataSetName of the data region’s ancestor is used instead.
<57> Section 2.271.4: In the file format validation implementation for CustomData.DataSetName
in SQL Server 2000 Reporting Services, SQL Server 2005 Reporting Services, SQL Server 2008
Reporting Services, and SQL Server 2008 R2 Reporting Services, if DataRegion has an ancestor, the
value of the DataSetName element is ignored. The value of the DataSetName of the data region's
ancestor is used instead.
<58> Section 2.278.2: The file format validation implementation in Reporting Services requires that
DataCell.DataSetName not be specified unless DataCell has both a containing row group and a
containing column group. This behavior does not apply to SQL Server 2000 Reporting Services, SQL
Server 2005 Reporting Services, SQL Server 2008 Reporting Services, and SQL Server 2008 R2
Reporting Services.
<59> Section 2.278.2: The file format validation implementation in Reporting Services requires that
DataCell.DataSetName does not specify the name of DataSet for the containing column group
unless the containing row group uses the same DataSet. This behavior does not apply to SQL Server
2000 Reporting Services, SQL Server 2005 Reporting Services, SQL Server 2008 Reporting Services,
and SQL Server 2008 R2 Reporting Services.
<60> Section 2.284.4: In the Microsoft implementation, the Top, Left, Height, and Width child
element values of the ReportItem element child are interpreted as being those of the
CustomReportItem element.
<61> Section 2.310.1:  Microsoft implementations require this value to be greater than or equal to 1
and less than or equal to 8.
<62> Section 2.310.2:  Microsoft implementations require this value to be greater than or equal to 1
and less than or equal to 10000.
<63> Section 2.311.1:  Microsoft implementations require the number of consecutive empty rows to
be less than or equal to 20.
<64> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Albanian_100 locale.
<65> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Amharic_100 locale.
<66> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Arabic_100 locale.
<67> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Armenian_100 locale.
<68> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Assamese_100 locale.
<69> Section 2.325.4: SQL Server 2000 Reporting Services does not support the Azeri_Cyrillic_90
locale.
<70> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Azeri_Cyrillic_100 locale.
<71> Section 2.325.4: SQL Server 2000 Reporting Services does not support the Azeri_Latin_90
locale.
<72> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Azeri_Latin_100 locale.
<73> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Bashkir_100 locale.
<74> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Bengali_100 locale.
<75> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Bosnian_Cyrillic_100 locale.
<76> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Bosnian_Latin_100 locale.
<77> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Breton_100 locale.
<78> Section 2.325.4: SQL Server 2000 Reporting Services does not support the
Chinese_Hong_Kong_Stroke_90 locale.
<79> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Chinese_Hong_Kong_Stroke_100 locale.
<80> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Chinese_Macao_100 locale.
<81> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Chinese_Macao_Stroke_100 locale.
<82> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Chinese_PRC_100 locale.
<83> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Chinese_PRC_Stroke_100 locale.
<84> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Chinese_Simplified_Pinyin_100 locale.
<85> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Chinese_Simplified_Stroke_Order_100 locale.
<86> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Chinese_Taiwan_Bopomofo_100 locale.
<87> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Chinese_Taiwan_Stroke_100 locale.
<88> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Chinese_Traditional_Bopomofo_100 locale.
<89> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Chinese_Traditional_Pinyin_100 locale.
<90> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Chinese_Traditional_Stroke_Count_100 locale.
<91> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Chinese_Traditional_Stroke_Order_100 locale.
<92> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Corsican_100 locale.
<93> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Croatian_100 locale.
<94> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Cyrillic_General_100 locale.
<95> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Czech_100 locale.
<96> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Danish_Greenlandic_100 locale.
<97> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Dari_100 locale.
<98> Section 2.325.4: SQL Server 2000 Reporting Services does not support the Divehi_90 locale.
<99> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Divehi_100 locale.
<100> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Estonian_100 locale.
<101> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Finnish_Swedish_100 locale.
<102> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the French_100 locale.
<103> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Frisian_100 locale.
<104> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Georgian_Traditional_100 locale.
<105> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the German_PhoneBook_100 locale.
<106> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Greek_100 locale.
<107> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Hebrew_100 locale.
<108> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Hungarian_100 locale.
<109> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Hungarian_Technical_100 locale.
<110> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Icelandic_100 locale.
<111> Section 2.325.4: SQL Server 2000 Reporting Services does not support the Indic_General_90
locale.
<112> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Indic_General_100 locale.
<113> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Inuktitut_100 locale.
<114> Section 2.325.4: SQL Server 2000 Reporting Services does not support the Japanese_90
locale.
<115> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Japanese_100 locale.
<116> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Japanese_Bushu_Kakusu_100 locale.
<117> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Japanese_Radical_Stroke_100 locale.
<118> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Japanese_Unicode locale.
<119> Section 2.325.4: SQL Server 2000 Reporting Services does not support the Kazakh_90 locale.
<120> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Kazakh_100 locale.
<121> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Khmer_100 locale.
<122> Section 2.325.4: SQL Server 2000 Reporting Services does not support the Korean_90 locale.
<123> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Korean_100 locale.
<124> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Lao_100 locale.
<125> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Latin1_General_100 locale.
<126> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Latvian_100 locale.
<127> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Lithuanian_100 locale.
<128> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Lithuanian_Classic locale.
<129> Section 2.325.4: SQL Server 2000 Reporting Services does not support the
Macedonian_FYROM_90 locale.
<130> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Macedonian_FYROM_100 locale.
<131> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Maltese_100 locale.
<132> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Maori_100 locale.
<133> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Mapudungan_100 locale.
<134> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Modern_Spanish_100 locale.
<135> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Mohawk_100 locale.
<136> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Mongolian_100 locale.
<137> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Nepali_100 locale.
<138> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Norwegian_100 locale.
<139> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Norwegian_Sami_100 locale.
<140> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Pashto_100 locale.
<141> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Persian_100 locale.
<142> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Polish_100 locale.
<143> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Romanian_100 locale.
<144> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Romansh_100 locale.
<145> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Sami_Norway_100 locale.
<146> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Sami_Sweden_Finland_100 locale.
<147> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Serbian_Cyrillic_100 locale.
<148> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Serbian_Latin_100 locale.
<149> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Slovak_100 locale.
<150> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Slovenian_100 locale.
<151> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Swedish_Finnish_Sami_100 locale.
<152> Section 2.325.4: SQL Server 2000 Reporting Services does not support the Syriac_90 locale.
<153> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Syriac_100 locale.
<154> Section 2.325.4: SQL Server 2000 Reporting Services does not support the Tatar_90 locale.
<155> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Tatar_100 locale.
<156> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Tamazight_100 locale.
<157> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Thai_100 locale.
<158> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Tibetan_PRC_100 locale.
<159> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Traditional_Spanish_100 locale.
<160> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Turkish_100 locale.
<161> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Turkmen_100 locale.
<162> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Uighur_PRC_100 locale.
<163> Section 2.325.4: SQL Server 2000 Reporting Services does not support the Ukrainian_100
locale.
<164> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Upper_Sorbian_100 locale.
<165> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Urdu_100 locale.
<166> Section 2.325.4: SQL Server 2000 Reporting Services does not support the Uzbek_Latin_90
locale.
<167> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Uzbek_Latin_100 locale.
<168> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Vietnamese_100 locale.
<169> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Welsh_100 locale.
<170> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Yakut_100 locale.
<171> Section 2.325.4: SQL Server 2000 Reporting Services and SQL Server 2005 Reporting Services
do not support the Yi_100 locale.
<172> Section 2.325.13: In the file format validation implementation in Reporting Services, the
behavior of DateTime values that specify dates before "March 1, 1900" is undefined when
DataSet.NullsAsBlanks is true. This behavior does not apply to SQL Server 2000 Reporting Services,
SQL Server 2005 Reporting Services, SQL Server 2008 Reporting Services, and SQL Server 2008 R2
Reporting Services.
<173> Section 2.328.5: In Reporting Services, Field.AggregateIndicatorField cannot be present
when Field.Value is present. If Field.AggregateIndicatorField refers to a Field in which the
Field.Value element is present, Field.Value on the referenced Field has to be a Boolean constant,
and Field.Vaue.DataType on the referenced Field has to be Boolean. This behavior does not apply
to SQL Server 2000 Reporting Services, SQL Server 2005 Reporting Services, SQL Server 2008
Reporting Services, and SQL Server 2008 R2 Reporting Services.
<174> Section 2.336: The file format validation implementation in Reporting Services requires that a
DefaultRelationship does not contain a circular reference. This behavior does not apply to SQL
Server 2000 Reporting Services, SQL Server 2005 Reporting Services, SQL Server 2008 Reporting
Services, and SQL Server 2008 R2 Reporting Services.
<175> Section 2.336: The file format validation implementation in Reporting Services requires that
DefaultRelationship specifies a JoinCondition. This behavior does not apply to SQL Server 2000
Reporting Services, SQL Server 2005 Reporting Services, SQL Server 2008 Reporting Services, and
SQL Server 2008 R2 Reporting Services.
<176> Section 2.336.1: The file format validation implementation in Reporting Services restricts the
value of the DefaultRelationship.RelatedDataSet element. This element has to be one of the
Dataset.Name attribute values of the Report. RelatedDataSet has to be unique among the
RelatedDataSet elements that are specified for other DefaultRelationship elements within the list of
DefaultRelationships in a dataset. RelatedDataSet cannot be equal to the containing
DataSet.Name. This behavior does not apply to SQL Server 2000 Reporting Services, SQL Server
2005 Reporting Services, SQL Server 2008 Reporting Services, and SQL Server 2008 R2 Reporting
Services.
<177> Section 2.336.2: The file format validation implementation in Reporting Services requires that
the DefaultRelationship.JoinConditions element is specified unless
DefaultRelationship.NaturalJoin is true and the DefaultRelationship is used to correlate
instances of a group scope with its containing DataRegion. This behavior does not apply to SQL
Server 2000 Reporting Services, SQL Server 2005 Reporting Services, SQL Server 2008 Reporting
Services, and SQL Server 2008 R2 Reporting Services.
<178> Section 2.336.3: The file format validation implementation in Reporting Services requires that
the DefaultRelationship.NaturalJoin element is specified for DefaultRelationship and that the
value of the DefaultRelationship.NaturalJoin element is not specified as false. This behavior does
not apply to SQL Server 2000 Reporting Services, SQL Server 2005 Reporting Services, SQL Server
2008 Reporting Services, and SQL Server 2008 R2 Reporting Services.
<179> Section 2.336.3: The file format validation implementation in Reporting Services requires that
when two DataRegions elements both specify a Relationship element and both DataRegions
elements are within the same top level DataRegion element, both DataRegions elements cannot
reference the same DataSet element. This behavior does not apply to SQL Server 2000 Reporting
Services, SQL Server 2005 Reporting Services, SQL Server 2008 Reporting Services, and SQL Server
2008 R2 Reporting Services.
<180> Section 2.338.1: The file format validation implementation in Reporting Services restricts the
content of JoinCondition.ForeignKey. This element cannot contain a reference to a ReportItem
object, a Variable element, or a RunningValue, Previous, or any other aggregate function. This
behavior does not apply to SQL Server 2000 Reporting Services, SQL Server 2005 Reporting Services,
SQL Server 2008 Reporting Services, and SQL Server 2008 R2 Reporting Services.
<181> Section 2.338.2: The file format validation implementation in Reporting Services restricts the
content of JoinCondition.PrimaryKey. This element cannot contain a reference to a ReportItem
object, a Variable element, or a RunningValue, Previous, or any other aggregate function. This
behavior does not apply to SQL Server 2000 Reporting Services, SQL Server 2005 Reporting Services,
SQL Server 2008 Reporting Services, and SQL Server 2008 R2 Reporting Services.
<182> Section 2.340: The file format validation implementation in Reporting Services requires that
when a Relationship element for a data scope specifies NaturalJoin, the containing Relationship
has to specify NaturalJoin. NaturalJoin is effective only if all containing Relationship elements
specify NaturalJoin. This behavior does not apply to SQL Server 2000 Reporting Services, SQL
Server 2005 Reporting Services, SQL Server 2008 Reporting Services, and SQL Server 2008 R2
Reporting Services.
<183> Section 2.340: The file format validation implementation in Reporting Services requires that
when two DataRegions both specify a Relationship that is within the same top-level DataRegion
element, both DataRegions elements cannot reference the same DataSet element. This behavior
does not apply to SQL Server 2000 Reporting Services, SQL Server 2005 Reporting Services, SQL
Server 2008 Reporting Services, and SQL Server 2008 R2 Reporting Services.
<184> Section 2.340: The file format validation implementation in Reporting Services requires that
when two DataRegions elements specify a Relationship element in which one DataRegions
element is the descendant of the other, both DataRegions elements cannot reference the same
DataSet element. This behavior does not apply to SQL Server 2000 Reporting Services, SQL Server
2005 Reporting Services, SQL Server 2008 Reporting Services, and SQL Server 2008 R2 Reporting
Services.
<185> Section 2.340: The file format validation implementation in Reporting Services requires that
Relationship specify JoinCondition. If JoinCondition is not specified, DefaultRelationship of
DataSet that ParentScope is bound to has to specify JoinCondition. This behavior does not apply
to SQL Server 2000 Reporting Services, SQL Server 2005 Reporting Services, SQL Server 2008
Reporting Services, and SQL Server 2008 R2 Reporting Services.
<186> Section 2.340.2: The file format validation implementation in Reporting Services requires that
when the Relationship.NaturalJoin element is specified for Relationship, the containing data scope
has to specify NaturalGroup. NaturalJoin is effective only if all containing groups specify
NaturalGroup. This behavior does not apply to SQL Server 2000 Reporting Services, SQL Server
2005 Reporting Services, SQL Server 2008 Reporting Services, and SQL Server 2008 R2 Reporting
Services.
<187> Section 2.340.3: The file format validation implementation in Reporting Services requires that
Relationship.JoinConditions be specified unless Relationship.NaturalJoin is true and
Relationship is used to correlate instances of a group scope with its containing DataRegion. This
behavior does not apply to SQL Server 2000 Reporting Services, SQL Server 2005 Reporting Services,
SQL Server 2008 Reporting Services, and SQL Server 2008 R2 Reporting Services.
<188> Section 2.341.3: The following namespaces and classes are available:
Microsoft.VisualBasic

System.Convert

System.Math

System

These standard namespaces specify frequently needed functionality as specified in [MSFT-VBNET].
<189> Section 2.341.4: In the Microsoft implementation, the following table specifies how expression
return types are converted to RDL data types.
RDL Type
CLR Types
String
String, Char, GUID
Boolean
Boolean
Integer
Int16, Int32, Int64, UInt16, UInt32, UInt64, Byte, SByte, TimeSpan
The implementation of Reporting Services can convert Integer expression results to 32-bit or
64-bit precision, depending on the usage context.
DateTime
DateTime, DateTimeOffset
Float
Single, Double, Decimal
Binary
Byte[]
Variant
One of the following RDL types: String, Boolean, Integer, DateTime, Float, or Binary.
VariantArray
Array of Variant.
Unless otherwise specified, in the Microsoft implementation, this is a true variant array (that is,
object[]), not a strongly typed array.
StringArray
Array of String
Numeric
One of the following RDL types: Integer or Float.
Scalar
One of the following RDL types: Integer, Float, or DateTime.
Serializable
An RDL Variant, which is a CLR type that is marked with Serializable [ECMA-335], or a CLR
type that implements ISerializable.
<190> Section 2.341.6.5: In the Microsoft implementation, only text box items appear as
ReportItem objects in the ReportItems collection. In third-party implementations, other items can
appear in the ReportItems collection.
<191> Section 2.341.6.6: The Name property is set to "RPL" if the current user request does not use
a rendering extension (such as a create history snapshot or toggle event).
The Name property is set to NULL for expressions that are evaluated during the data processing
phase (for example, grouping, sorting, and filtering).
<192> Section 2.341.6.6: The collection is empty for user requests that do not use a rendering
extension (such as a create history snapshot or toggle event) and for expressions that are evaluated
during the data processing phase (for example, grouping, sorting, and filtering).
<193> Section 2.341.6.12: The restriction of the use of the DataSet and DataSource collections in
expressions within Field elements is not implemented in Reporting Services.
<194> Section 2.341.7.26.7: The Microsoft implementation allows strongly typed arrays in addition to
object[].
<195> Section 2.341.7.26.7: The Microsoft implementation allows strongly typed arrays in addition to
object[].
<196> Section 6.387: In Reporting Services, rsInvalidAggregateIndicatorField also occurs if
Field.AggregateIndicatorField refers to a field with a Field.Value element that does not have an
constant Boolean value or that does not have Field.Value.DataType set to "Boolean". This behavior
does not apply to SQL Server 2000 Reporting Services, SQL Server 2005 Reporting Services, SQL
Server 2008 Reporting Services, and SQL Server 2008 R2 Reporting Services.
